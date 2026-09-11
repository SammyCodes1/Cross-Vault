import { ethers } from 'ethers';
import { fetchSepoliaProof } from '../src/prover';
import {
  CROSS_VAULT_ABI,
  PYTH_CONTRACT_SEPOLIA,
  PYTH_ETH_FEED_ID,
  pythInterface,
  decodeRevertReason,
  crossVaultInterface,
} from '../src/contracts';
import {
  SEPOLIA_RPC_URL,
  CC3_TESTNET_RPC_URL,
  CC3_PRIVATE_KEY,
  getDeployedCreditcoin,
} from '../src/config';

async function main() {
  if (!CC3_PRIVATE_KEY) {
    throw new Error('CC3_PRIVATE_KEY must be set');
  }

  const deployments = getDeployedCreditcoin();
  const vaultAddress = deployments.crossVault || deployments.CrossVault;
  if (!vaultAddress) {
    throw new Error('crossVault missing from deployed-creditcoin.json');
  }

  const sepolia = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
  const latest = await sepolia.getBlockNumber();
  const topic = pythInterface.getEvent('PriceFeedUpdate')!.topicHash;
  const logs = await sepolia.getLogs({
    address: PYTH_CONTRACT_SEPOLIA,
    topics: [topic, PYTH_ETH_FEED_ID],
    fromBlock: Math.max(0, latest - 1500),
    toBlock: 'latest',
  });
  if (logs.length === 0) {
    throw new Error(`No Pyth ETH/USD logs on ${PYTH_CONTRACT_SEPOLIA} in the last 1500 blocks`);
  }
  const log = logs[logs.length - 1];
  console.log(`[attest-pyth] Using Sepolia tx ${log.transactionHash} block ${log.blockNumber}`);

  const proof = await fetchSepoliaProof(log.transactionHash, log.blockNumber);

  const cc3 = new ethers.JsonRpcProvider(CC3_TESTNET_RPC_URL);
  const signer = new ethers.Wallet(CC3_PRIVATE_KEY, cc3);
  const vault = new ethers.Contract(vaultAddress, CROSS_VAULT_ABI, signer);

  console.log(`[attest-pyth] Submitting updatePriceFromPyth to ${vaultAddress}`);
  try {
    const tx = await vault.updatePriceFromPyth(proof, { gasPrice: 2000000000n });
    const receipt = await tx.wait();
    const source = await vault.priceSource();
    const price = await vault.currentPrice();
    console.log(`[attest-pyth] CC3 tx ${receipt.hash}`);
    console.log(`[attest-pyth] source=${source} price=${ethers.formatEther(price)}`);
  } catch (err: any) {
    throw new Error(`updatePriceFromPyth reverted: ${decodeRevertReason(err, crossVaultInterface)}`);
  }
}

main().catch((err) => {
  console.error('[attest-pyth] FAILED', err);
  process.exit(1);
});
