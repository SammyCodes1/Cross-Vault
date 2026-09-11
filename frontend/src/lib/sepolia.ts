import { ethers } from 'ethers';
import { NETWORKS } from '../contracts/config';

const SEPOLIA_RPCS = [
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://rpc.sepolia.org',
  'https://1rpc.io/sepolia',
  'https://eth-sepolia.public.blastapi.io',
];

let cached: ethers.JsonRpcProvider | null = null;

export function mapSepoliaRpcError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes('drpc.org') ||
    msg.includes('free plan') ||
    msg.includes('chain is not available')
  ) {
    return new Error(
      'Your wallet is using a blocked Sepolia RPC (dRPC). In MetaMask: Settings → Networks → Sepolia → set RPC URL to https://ethereum-sepolia-rpc.publicnode.com then try again.'
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

export async function getSepoliaProvider(): Promise<ethers.JsonRpcProvider> {
  if (cached) {
    try {
      await cached.getBlockNumber();
      return cached;
    } catch {
      cached = null;
    }
  }
  for (const url of SEPOLIA_RPCS) {
    try {
      const provider = new ethers.JsonRpcProvider(url, NETWORKS.SEPOLIA.chainId, {
        staticNetwork: true,
      });
      await provider.getBlockNumber();
      cached = provider;
      return provider;
    } catch {
      /* try next */
    }
  }
  throw new Error('Could not reach a public Sepolia RPC. Try again in a moment.');
}

export async function waitForSepoliaWallet(switchFn: () => Promise<void>): Promise<void> {
  if (!window.ethereum) {
    throw new Error('No wallet found. Open this page in MetaMask or another EVM wallet.');
  }
  await switchFn();
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const hex = await window.ethereum.request({ method: 'eth_chainId' });
    if (parseInt(hex, 16) === NETWORKS.SEPOLIA.chainId) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error('Wallet is not on Sepolia. Switch to Sepolia in the wallet and try again.');
}

export async function sendSepoliaTx(
  signer: ethers.JsonRpcSigner,
  tx: { to: string; data: string }
): Promise<{ hash: string; receipt: ethers.TransactionReceipt }> {
  try {
    const sepolia = await getSepoliaProvider();
    const from = await signer.getAddress();
    const [nonce, fee, gas] = await Promise.all([
      sepolia.getTransactionCount(from, 'pending'),
      sepolia.getFeeData(),
      sepolia.estimateGas({ from, to: tx.to, data: tx.data }),
    ]);
    const sent = await signer.sendTransaction({
      to: tx.to,
      data: tx.data,
      chainId: NETWORKS.SEPOLIA.chainId,
      nonce,
      gasLimit: (gas * 12n) / 10n,
      maxFeePerGas: fee.maxFeePerGas ?? undefined,
      maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? undefined,
    });
    const receipt = await sepolia.waitForTransaction(sent.hash, 1, 180000);
    if (!receipt || receipt.status !== 1) {
      throw new Error('Sepolia transaction failed or was dropped');
    }
    return { hash: sent.hash, receipt };
  } catch (err) {
    throw mapSepoliaRpcError(err);
  }
}
