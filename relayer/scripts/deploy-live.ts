import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { ethers } from 'ethers';
import {
  SEPOLIA_RPC_URL,
  SEPOLIA_PRIVATE_KEY,
  CC3_TESTNET_RPC_URL,
  CC3_PRIVATE_KEY,
} from '../src/config';

async function main() {
  console.log('===============================================================');
  console.log('  CrossVault Live Testnet Deployment & Setup');
  console.log('===============================================================');

  if (!SEPOLIA_PRIVATE_KEY || !CC3_PRIVATE_KEY) {
    console.error('[Error] SEPOLIA_PRIVATE_KEY and CC3_PRIVATE_KEY must be set in .env');
    process.exit(1);
  }

  const rootDir = path.resolve(__dirname, '../../');
  const sepoliaDir = path.resolve(rootDir, 'contracts-sepolia');
  const creditcoinDir = path.resolve(rootDir, 'contracts-creditcoin');

  console.log('\n--- 1. Deploying Sepolia Contracts ---');
  execSync(
    `forge script script/Deploy.s.sol --rpc-url "${SEPOLIA_RPC_URL}" --broadcast --private-key "${SEPOLIA_PRIVATE_KEY}"`,
    { cwd: sepoliaDir, stdio: 'inherit' }
  );

  console.log('\n--- 2. Deploying Creditcoin 3 Contracts ---');
  execSync(
    `forge script script/Deploy.s.sol --rpc-url "${CC3_TESTNET_RPC_URL}" --broadcast --private-key "${CC3_PRIVATE_KEY}"`,
    { cwd: creditcoinDir, stdio: 'inherit' }
  );

  const deployedSepolia = JSON.parse(
    fs.readFileSync(path.resolve(rootDir, 'deployed-sepolia.json'), 'utf-8')
  );
  const deployedCreditcoin = JSON.parse(
    fs.readFileSync(path.resolve(rootDir, 'deployed-creditcoin.json'), 'utf-8')
  );

  console.log('\nDeployment Summary:');
  console.log('Sepolia:');
  console.log(`  MockCollateralToken: ${deployedSepolia.mockCollateralToken || deployedSepolia.MockCollateralToken}`);
  console.log(`  CollateralLock:      ${deployedSepolia.collateralLock || deployedSepolia.CollateralLock}`);
  console.log(`  MockPriceFeed:       ${deployedSepolia.mockPriceFeed || deployedSepolia.MockPriceFeed}`);
  console.log('Creditcoin 3:');
  console.log(`  DebtToken:           ${deployedCreditcoin.debtToken}`);
  console.log(`  CrossVault:          ${deployedCreditcoin.crossVault}`);

  console.log('\nDeployment completed successfully.');
}

main().catch((err) => {
  console.error('Deployment error:', err);
  process.exit(1);
});
