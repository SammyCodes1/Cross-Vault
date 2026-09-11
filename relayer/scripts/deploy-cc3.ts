import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import {
  CC3_TESTNET_RPC_URL,
  CC3_PRIVATE_KEY,
  getDeployedSepolia,
} from '../src/config';

async function deployToCreditcoin() {
  console.log('===============================================================');
  console.log('  Deploying CrossVault to Creditcoin 3 Testnet');
  console.log('===============================================================');

  if (!CC3_PRIVATE_KEY) {
    throw new Error('CC3_PRIVATE_KEY not set');
  }

  const provider = new ethers.JsonRpcProvider(CC3_TESTNET_RPC_URL);
  const signer = new ethers.Wallet(CC3_PRIVATE_KEY, provider);

  console.log(`Deployer Address: ${signer.address}`);
  const balance = await provider.getBalance(signer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} tCTC`);

  const rootDir = path.resolve(__dirname, '../../');
  const deployedSepolia = getDeployedSepolia();
  const collateralLockAddress = deployedSepolia.collateralLock || deployedSepolia.CollateralLock;
  const priceFeedAddress = deployedSepolia.mockPriceFeed || deployedSepolia.MockPriceFeed;

  console.log(`Linked Sepolia CollateralLock: ${collateralLockAddress}`);
  console.log(`Linked Sepolia MockPriceFeed:  ${priceFeedAddress}`);

  if (!collateralLockAddress || !priceFeedAddress) {
    throw new Error('Sepolia contract addresses not found in deployed-sepolia.json');
  }

  const debtTokenArtifact = JSON.parse(
    fs.readFileSync(
      path.resolve(rootDir, 'contracts-creditcoin/out/DebtToken.sol/DebtToken.json'),
      'utf-8'
    )
  );
  const crossVaultArtifact = JSON.parse(
    fs.readFileSync(
      path.resolve(rootDir, 'contracts-creditcoin/out/CrossVault.sol/CrossVault.json'),
      'utf-8'
    )
  );

  const gas = { gasPrice: ethers.parseUnits('2', 'gwei') };

  console.log('\n--- 1. Deploying DebtToken ---');
  const debtTokenFactory = new ethers.ContractFactory(
    debtTokenArtifact.abi,
    debtTokenArtifact.bytecode.object,
    signer
  );
  const debtToken = await debtTokenFactory.deploy(ethers.ZeroAddress, gas);
  console.log(`DebtToken tx: ${debtToken.deploymentTransaction()?.hash}`);
  await debtToken.waitForDeployment();
  const debtTokenAddress = await debtToken.getAddress();
  console.log(`DebtToken deployed to: ${debtTokenAddress}`);

  console.log('\n--- 2. Deploying CrossVault ---');
  const crossVaultFactory = new ethers.ContractFactory(
    crossVaultArtifact.abi,
    crossVaultArtifact.bytecode.object,
    signer
  );
  const crossVault = await crossVaultFactory.deploy(
    collateralLockAddress,
    priceFeedAddress,
    debtTokenAddress,
    1n,
    gas
  );
  console.log(`CrossVault tx: ${crossVault.deploymentTransaction()?.hash}`);
  await crossVault.waitForDeployment();
  const crossVaultAddress = await crossVault.getAddress();
  console.log(`CrossVault deployed to: ${crossVaultAddress}`);

  console.log('\n--- 3. Binding CrossVault as DebtToken vault ---');
  const setVaultTx = await (debtToken as any).setVault(crossVaultAddress, gas);
  console.log(`setVault tx: ${setVaultTx.hash}`);
  await setVaultTx.wait();
  console.log('Vault bound.');

  const deployedCreditcoin = {
    network: 'creditcoin3-testnet',
    chainId: 102031,
    debtToken: debtTokenAddress,
    crossVault: crossVaultAddress,
  };

  const outputPath = path.resolve(rootDir, 'deployed-creditcoin.json');
  fs.writeFileSync(outputPath, JSON.stringify(deployedCreditcoin, null, 2));
  console.log(`\nDeployment details written to: ${outputPath}`);
  console.log('===============================================================');
  console.log('  Creditcoin 3 Deployment Complete!');
  console.log('===============================================================');
}

deployToCreditcoin().catch((err) => {
  console.error('Creditcoin deployment failed:', err);
  process.exit(1);
});
