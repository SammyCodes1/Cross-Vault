import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import { SEPOLIA_RPC_URL, SEPOLIA_PRIVATE_KEY, getDeployedSepolia } from '../src/config';

const RPCS = [
  SEPOLIA_RPC_URL,
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://rpc.sepolia.org',
  'https://1rpc.io/sepolia',
].filter(Boolean);

async function provider(): Promise<ethers.JsonRpcProvider> {
  for (const url of RPCS) {
    try {
      const p = new ethers.JsonRpcProvider(url, 11155111, { staticNetwork: true });
      await p.getBlockNumber();
      console.log(`Sepolia RPC: ${url}`);
      return p;
    } catch {
      /* next */
    }
  }
  throw new Error('No working Sepolia RPC');
}

async function main() {
  if (!SEPOLIA_PRIVATE_KEY) throw new Error('SEPOLIA_PRIVATE_KEY not set');
  const sepolia = await provider();
  const signer = new ethers.Wallet(SEPOLIA_PRIVATE_KEY, sepolia);
  const deployed = getDeployedSepolia();
  const token =
    deployed.mockCollateralToken || deployed.MockCollateralToken;
  if (!token) throw new Error('mockCollateralToken missing from deployed-sepolia.json');

  const rootDir = path.resolve(__dirname, '../../');
  const artifact = JSON.parse(
    fs.readFileSync(
      path.resolve(rootDir, 'contracts-sepolia/out/CollateralLock.sol/CollateralLock.json'),
      'utf-8'
    )
  );

  console.log(`Deployer: ${signer.address}`);
  console.log(`mWETH:    ${token}`);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, signer);
  const lock = await factory.deploy(token);
  console.log(`tx: ${lock.deploymentTransaction()?.hash}`);
  await lock.waitForDeployment();
  const lockAddress = await lock.getAddress();
  console.log(`CollateralLock: ${lockAddress}`);

  const next = {
    ...deployed,
    collateralLock: lockAddress,
    CollateralLock: lockAddress,
  };
  fs.writeFileSync(
    path.resolve(rootDir, 'deployed-sepolia.json'),
    JSON.stringify(next, null, 2) + '\n'
  );
  console.log('Wrote deployed-sepolia.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
