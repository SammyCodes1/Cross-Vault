import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { fetchSepoliaProof } from '../src/prover';
import {
  CROSS_VAULT_ABI,
  DEBT_TOKEN_ABI,
  decodeRevertReason,
  crossVaultInterface,
} from '../src/contracts';
import { getDeployedCreditcoin, getDeployedSepolia } from '../src/config';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  console.log('===============================================================');
  console.log('  CrossVault Complete Live Flow Execution on Sepolia & CC3');
  console.log('===============================================================');

  const sepoliaDeployments = getDeployedSepolia();
  const cc3Deployments = getDeployedCreditcoin();

  const crossVaultAddress = cc3Deployments.crossVault!;
  const debtTokenAddress = cc3Deployments.debtToken!;
  const priceFeedAddress = sepoliaDeployments.mockPriceFeed!;
  const collateralLockAddress = sepoliaDeployments.collateralLock!;

  const sepRpc = process.env.SEPOLIA_RPC_URL!;
  const cc3Rpc = process.env.CC3_TESTNET_RPC_URL!;
  const privKey = process.env.CC3_PRIVATE_KEY!;

  const sepProvider = new ethers.JsonRpcProvider(sepRpc);
  const cc3Provider = new ethers.JsonRpcProvider(cc3Rpc);

  const walletCc3 = new ethers.Wallet(privKey, cc3Provider);

  console.log(`Wallet Address: ${walletCc3.address}`);

  const crossVault = new ethers.Contract(crossVaultAddress, CROSS_VAULT_ABI, walletCc3);
  const debtToken = new ethers.Contract(debtTokenAddress, DEBT_TOKEN_ABI, walletCc3);

  // Check current status
  const currentPrice = await crossVault.currentPrice();
  console.log(`Current CrossVault Price on CC3: $${ethers.formatEther(currentPrice)} tvUSD`);

  const pos1 = await crossVault.positions(1);
  console.log('Position 1 Initial State:', {
    owner: pos1.owner,
    collateral: ethers.formatEther(pos1.collateralAmount),
    debt: ethers.formatEther(pos1.debtAmount),
    liquidated: pos1.liquidated,
  });

  const isLiq1Before = await crossVault.isLiquidatable(1);
  console.log(`Position 1 isLiquidatable (Before Price Drop): ${isLiq1Before}`);

  // Step A: Attest Price Drop ($1600 at block 11668405)
  if (currentPrice !== ethers.parseEther('1600')) {
    const priceDropTx = '0x532e650bc7c34af9f6e0765bd169016201b7246f0e86cdd8d97c640dd50a924c';
    const priceDropBlock = 11668405;

    console.log(`\n--- Step 1: Waiting for USC Prover & Attesting Price Drop ($1,600) ---`);
    console.log(`Price Drop Tx: ${priceDropTx} at block ${priceDropBlock}`);
    const priceProof = await fetchSepoliaProof(priceDropTx, priceDropBlock);
    console.log(`Proof generated! Submitting updatePrice to CC3 CrossVault...`);

    const updatePriceTx = await crossVault.updatePrice(priceProof, {
      gasPrice: ethers.parseUnits('2', 'gwei'),
    });
    console.log(`updatePrice broadcast: ${updatePriceTx.hash}. Waiting for confirmation...`);
    await updatePriceTx.wait();
    console.log(`updatePrice confirmed!`);
  } else {
    console.log(`\n--- Step 1: Price Drop ($1,600) Already Confirmed On-Chain ---`);
  }

  const newPrice = await crossVault.currentPrice();
  console.log(`Current CrossVault Price on CC3: $${ethers.formatEther(newPrice)} tvUSD`);

  // Step B: Confirm isLiquidatable flips to true
  console.log(`\n--- Step 2: Confirming isLiquidatable flips to TRUE ---`);
  const isLiq1After = await crossVault.isLiquidatable(1);
  console.log(`Position 1 isLiquidatable (After Price Drop): ${isLiq1After}`);
  if (!isLiq1After) {
    throw new Error('Expected isLiquidatable(1) to be TRUE after price drop to $1,600!');
  }
  console.log('✓ Successfully verified: isLiquidatable flipped from FALSE to TRUE!');

  // Step C: Liquidate Position 1
  console.log(`\n--- Step 3: Executing Liquidation of Position 1 ---`);
  const bal = await debtToken.balanceOf(walletCc3.address);
  console.log(`Wallet tvUSD Balance: ${ethers.formatEther(bal)} tvUSD`);

  const allowance: bigint = await debtToken.allowance(walletCc3.address, crossVaultAddress);
  if (allowance < pos1.debtAmount) {
    console.log(`Approving CrossVault for tvUSD debt token...`);
    const appTx = await debtToken.approve(crossVaultAddress, ethers.MaxUint256, {
      gasPrice: ethers.parseUnits('2', 'gwei'),
    });
    await appTx.wait();
    console.log(`Approved!`);
  }

  console.log(`Calling CrossVault.liquidate(1)...`);
  const liqTx = await crossVault.liquidate(1, {
    gasPrice: ethers.parseUnits('2', 'gwei'),
  });
  console.log(`liquidate broadcast: ${liqTx.hash}. Waiting for confirmation...`);
  const liqReceipt = await liqTx.wait();
  console.log(`Liquidation confirmed in block ${liqReceipt.blockNumber}!`);

  const pos1After = await crossVault.positions(1);
  console.log('Position 1 State After Liquidation:', {
    owner: pos1After.owner,
    collateral: ethers.formatEther(pos1After.collateralAmount),
    debt: ethers.formatEther(pos1After.debtAmount),
    liquidated: pos1After.liquidated,
  });

  if (!pos1After.liquidated) {
    throw new Error('Expected Position 1 to be liquidated!');
  }
  console.log('✓ Successfully liquidated Position 1!');

  // Step D: Open Position 2 (from lockId 2 at block 11668411)
  const lock2Tx = '0x49fa7e1e33144c3915d1cee0d4c5d840457e0e98162b7c08122ce505907dab36';
  const lock2Block = 11668411;
  console.log(`\n--- Step 4: Attesting and Opening Position 2 (lockId 2) ---`);
  console.log(`Lock 2 Tx: ${lock2Tx} at block ${lock2Block}`);

  const lock2Proof = await fetchSepoliaProof(lock2Tx, lock2Block);
  console.log(`Proof generated for lockId 2! Submitting openPosition(2)...`);

  const openTx = await crossVault.openPosition(2n, lock2Proof, {
    gasPrice: ethers.parseUnits('2', 'gwei'),
  });
  console.log(`openPosition(2) broadcast: ${openTx.hash}. Waiting for confirmation...`);
  await openTx.wait();
  console.log(`openPosition(2) confirmed!`);

  const pos2 = await crossVault.positions(2);
  console.log('Position 2 State:', {
    owner: pos2.owner,
    collateral: ethers.formatEther(pos2.collateralAmount),
    debt: ethers.formatEther(pos2.debtAmount),
    liquidated: pos2.liquidated,
  });

  console.log('===============================================================');
  console.log('  Complete Live Cross-Chain Flow Succeeded with 100% Verification!');
  console.log('===============================================================');
}

main().catch((err) => {
  console.error('Live flow failed:', err);
  process.exit(1);
});
