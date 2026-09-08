import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Try loading .env from repo root or relayer directory
const rootEnvPath = path.resolve(__dirname, '../../.env');
const localEnvPath = path.resolve(__dirname, '../.env');

if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else if (fs.existsSync(localEnvPath)) {
  dotenv.config({ path: localEnvPath });
} else {
  dotenv.config();
}

export const SEPOLIA_RPC_URL =
  process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';

export const SEPOLIA_PRIVATE_KEY = process.env.SEPOLIA_PRIVATE_KEY || '';

export const CC3_TESTNET_RPC_URL =
  process.env.CC3_TESTNET_RPC_URL || 'https://rpc.cc3-testnet.creditcoin.network';

export const CC3_TESTNET_CHAIN_ID = parseInt(
  process.env.CC3_TESTNET_CHAIN_ID || '102031',
  10
);

export const CC3_PRIVATE_KEY = process.env.CC3_PRIVATE_KEY || '';

export const USC_PROVER_API_URL =
  process.env.USC_PROVER_API_URL || 'https://prover.cc3-testnet.creditcoin.network';

export const SEPOLIA_CHAIN_KEY = 1;

export const PORT = parseInt(process.env.PORT || '3001', 10);

export interface DeployedSepolia {
  CollateralLock?: string;
  collateralLock?: string;
  MockCollateralToken?: string;
  mockCollateralToken?: string;
  MockPriceFeed?: string;
  mockPriceFeed?: string;
}

export interface DeployedCreditcoin {
  network?: string;
  chainId?: number;
  debtToken?: string;
  DebtToken?: string;
  crossVault?: string;
  CrossVault?: string;
}

export function getDeployedSepolia(): DeployedSepolia {
  const possiblePaths = [
    path.resolve(process.cwd(), 'deployed-sepolia.json'),
    path.resolve(process.cwd(), '../deployed-sepolia.json'),
    path.resolve(__dirname, '../../deployed-sepolia.json'),
    path.resolve(__dirname, '../deployed-sepolia.json'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      } catch (e) {
        console.error(`Failed to parse ${p}:`, e);
      }
    }
  }

  return {};
}

export function getDeployedCreditcoin(): DeployedCreditcoin {
  const possiblePaths = [
    path.resolve(process.cwd(), 'deployed-creditcoin.json'),
    path.resolve(process.cwd(), '../deployed-creditcoin.json'),
    path.resolve(__dirname, '../../deployed-creditcoin.json'),
    path.resolve(__dirname, '../deployed-creditcoin.json'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      } catch (e) {
        console.error(`Failed to parse ${p}:`, e);
      }
    }
  }

  return {};
}
