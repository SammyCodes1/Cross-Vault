import { ethers } from 'ethers';
import request from 'supertest';
import { app } from '../src/server';
import {
  SEPOLIA_RPC_URL,
  SEPOLIA_PRIVATE_KEY,
  CC3_TESTNET_RPC_URL,
  CC3_PRIVATE_KEY,
  getDeployedSepolia,
  getDeployedCreditcoin,
} from '../src/config';
import {
  COLLATERAL_LOCK_ABI,
  MOCK_COLLATERAL_TOKEN_ABI,
  MOCK_PRICE_FEED_ABI,
  CROSS_VAULT_ABI,
  collateralLockInterface,
} from '../src/contracts';

/**
 * End-to-End Live Testnet Integration Test
 *
 * Requirements:
 * 1. Locks collateral on Ethereum Sepolia testnet.
 * 2. Calls the relayer endpoint POST /attest/lock/:lockId.
 * 3. Confirms that CrossVault on CC3 testnet records a real position with the correct collateral amount.
 */
export async function runIntegrationTest() {
  console.log('===============================================================');
  console.log('  CrossVault Live Testnet Integration Test');
  console.log('===============================================================');

  // Check required environment configuration
  if (!SEPOLIA_PRIVATE_KEY || !CC3_PRIVATE_KEY) {
    console.error('[Error] SEPOLIA_PRIVATE_KEY and CC3_PRIVATE_KEY must be set in .env');
    console.error('Please configure your .env file with funded testnet private keys.');
    process.exit(1);
  }

  const sepoliaProvider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
  const cc3Provider = new ethers.JsonRpcProvider(CC3_TESTNET_RPC_URL);

  const sepoliaSigner = new ethers.Wallet(SEPOLIA_PRIVATE_KEY, sepoliaProvider);
  const cc3Signer = new ethers.Wallet(CC3_PRIVATE_KEY, cc3Provider);

  console.log(`Sepolia Signer Address: ${sepoliaSigner.address}`);
  console.log(`Creditcoin 3 Signer Address: ${cc3Signer.address}`);

  const sepoliaBalance = await sepoliaProvider.getBalance(sepoliaSigner.address);
  const cc3Balance = await cc3Provider.getBalance(cc3Signer.address);

  console.log(`Sepolia ETH Balance: ${ethers.formatEther(sepoliaBalance)} ETH`);
  console.log(`Creditcoin 3 Balance: ${ethers.formatEther(cc3Balance)} tCTC`);

  if (sepoliaBalance === 0n) {
    throw new Error(`Insufficient Sepolia ETH on address ${sepoliaSigner.address}. Please fund with faucet.`);
  }

  if (cc3Balance === 0n) {
    throw new Error(`Insufficient CC3 tCTC on address ${cc3Signer.address}. Please fund with faucet.`);
  }

  const sepoliaDeployments = getDeployedSepolia();
  const cc3Deployments = getDeployedCreditcoin();

  const collateralLockAddress = sepoliaDeployments.collateralLock || sepoliaDeployments.CollateralLock;
  const tokenAddress = sepoliaDeployments.mockCollateralToken || sepoliaDeployments.MockCollateralToken;
  const priceFeedAddress = sepoliaDeployments.mockPriceFeed || sepoliaDeployments.MockPriceFeed;
  const crossVaultAddress = cc3Deployments.crossVault || cc3Deployments.CrossVault;

  console.log(`CollateralLock (Sepolia): ${collateralLockAddress}`);
  console.log(`MockCollateralToken (Sepolia): ${tokenAddress}`);
  console.log(`MockPriceFeed (Sepolia): ${priceFeedAddress}`);
  console.log(`CrossVault (CC3): ${crossVaultAddress}`);

  if (!collateralLockAddress || !tokenAddress || !crossVaultAddress) {
    throw new Error('Contract addresses missing. Ensure contracts are deployed to testnets.');
  }

  const token = new ethers.Contract(tokenAddress, MOCK_COLLATERAL_TOKEN_ABI, sepoliaSigner);
  const collateralLock = new ethers.Contract(collateralLockAddress, COLLATERAL_LOCK_ABI, sepoliaSigner);
  const crossVault = new ethers.Contract(crossVaultAddress, CROSS_VAULT_ABI, cc3Signer);

  // 1. Ensure MockPriceFeed has a valid price on Sepolia and CrossVault has currentPrice > 0
  const crossVaultPrice: bigint = await crossVault.currentPrice();
  console.log(`CrossVault currentPrice on CC3: ${ethers.formatUnits(crossVaultPrice, 18)} USD`);

  if (crossVaultPrice === 0n && priceFeedAddress) {
    console.log('[Setup] Setting price on Sepolia MockPriceFeed...');
    const priceFeed = new ethers.Contract(priceFeedAddress, MOCK_PRICE_FEED_ABI, sepoliaSigner);
    const initialPrice = ethers.parseUnits('3000', 18);
    const setPriceTx = await priceFeed.setPrice(initialPrice);
    await setPriceTx.wait();
    console.log(`MockPriceFeed updated to $3000 in tx ${setPriceTx.hash}`);

    console.log('[Setup] Calling relayer POST /attest/price to sync initial price to CrossVault...');
    const priceRes = await request(app).post('/attest/price');
    console.log('Price attest response:', priceRes.status, priceRes.body);
    if (priceRes.status !== 200) {
      throw new Error(`Failed to attest initial price: ${JSON.stringify(priceRes.body)}`);
    }
  }

  // 2. Mint test collateral on Sepolia
  const lockAmount = ethers.parseEther('0.1'); // 0.1 mWETH
  console.log(`Minting 0.1 mWETH to ${sepoliaSigner.address}...`);
  const mintTx = await token.mint(sepoliaSigner.address, lockAmount);
  await mintTx.wait();

  // 3. Approve CollateralLock
  console.log('Approving CollateralLock to spend mWETH...');
  const approveTx = await token.approve(collateralLockAddress, lockAmount);
  await approveTx.wait();

  // 4. Lock collateral on Sepolia
  console.log(`Locking 0.1 mWETH in CollateralLock on Sepolia...`);
  const lockTx = await collateralLock.lock(lockAmount);
  const lockReceipt = await lockTx.wait();
  console.log(`Lock confirmed on Sepolia in tx ${lockReceipt.hash}`);

  // Extract lockId from Locked event
  let lockedId: bigint | null = null;
  for (const log of lockReceipt.logs) {
    try {
      const parsed = collateralLockInterface.parseLog(log);
      if (parsed && parsed.name === 'Locked') {
        lockedId = parsed.args.lockId;
        break;
      }
    } catch {}
  }

  if (lockedId === null) {
    throw new Error('Locked event not found in transaction receipt');
  }
  console.log(`[Sepolia] Successfully locked collateral with lockId = ${lockedId.toString()}`);

  // 5. Call Relayer endpoint POST /attest/lock/:lockId
  console.log(`[Relayer] Calling POST /attest/lock/${lockedId.toString()}...`);
  const attestResponse = await request(app).post(`/attest/lock/${lockedId.toString()}`);

  console.log(`Relayer HTTP Response Code: ${attestResponse.status}`);
  console.log('Relayer Response Body:', attestResponse.body);

  if (attestResponse.status !== 200) {
    throw new Error(`Relayer failed to attest lock: ${JSON.stringify(attestResponse.body)}`);
  }

  const { transactionHash, positionId } = attestResponse.body;
  console.log(`[CC3] Position #${positionId} opened in tx ${transactionHash}`);

  // 6. Verify directly on CrossVault smart contract on CC3
  console.log(`[Verification] Querying CrossVault.getPosition(${positionId}) directly on CC3...`);
  const position = await crossVault.getPosition(positionId);

  console.log('On-Chain Position Data:');
  console.log(`  Owner:              ${position.owner}`);
  console.log(`  Collateral Amount:  ${ethers.formatEther(position.collateralAmount)} mWETH`);
  console.log(`  Debt Amount:        ${ethers.formatUnits(position.debtAmount, 18)} tvUSD`);
  console.log(`  Liquidated:         ${position.liquidated}`);

  // 7. Assert correctness
  if (position.owner.toLowerCase() !== sepoliaSigner.address.toLowerCase()) {
    throw new Error(`Owner mismatch: expected ${sepoliaSigner.address}, got ${position.owner}`);
  }

  if (position.collateralAmount !== lockAmount) {
    throw new Error(`Collateral mismatch: expected ${lockAmount.toString()}, got ${position.collateralAmount.toString()}`);
  }

  if (position.liquidated !== false) {
    throw new Error('Position should not be liquidated');
  }

  if (position.debtAmount === 0n) {
    throw new Error('Debt amount must be greater than 0');
  }

  console.log('===============================================================');
  console.log('🎉 Integration Test PASSED: Real position verified on CC3 testnet!');
  console.log('===============================================================');
}

if (require.main === module) {
  runIntegrationTest().catch((err) => {
    console.error('Integration test failed with error:', err);
    process.exit(1);
  });
}
