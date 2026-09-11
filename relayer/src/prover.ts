import { proofProvider } from '@gluwa/usc-sdk';
import { SEPOLIA_CHAIN_KEY, USC_PROVER_API_URL } from './config';

export interface TxProofPayload {
  height: bigint | number;
  encodedTx: string;
  merkleProof: {
    root: string;
    siblings: Array<{
      hash: string;
      isLeft: boolean;
    }>;
  };
  continuityProof: {
    lowerEndpointDigest: string;
    roots: string[];
  };
}

const POLL_MS = 2000;
const EXTRA_DELAY_MS = 1500;
const WAIT_TIMEOUT_MS = 900000;

async function queryAttestedHeight(): Promise<number | null> {
  const base = USC_PROVER_API_URL.replace(/\/$/, '');
  const res = await fetch(`${base}/api/v1/attested-height/${SEPOLIA_CHAIN_KEY}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { attestedHeight?: number };
  return typeof data.attestedHeight === 'number' ? data.attestedHeight : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until Creditcoin has attested the Sepolia block, then fetch the proof.
 * Still waits for the real attested height. Only the extra padding and poll
 * interval are tightened so we notice readiness sooner.
 */
export async function fetchSepoliaProof(
  transactionHash: string,
  blockHeight: number,
  onProgress?: (message: string) => void
): Promise<TxProofPayload> {
  console.log(`[Prover] Initializing ProofBuilder for chain ${SEPOLIA_CHAIN_KEY} at ${USC_PROVER_API_URL}`);
  const proofBuilder = new proofProvider.service.ProofBuilder(
    SEPOLIA_CHAIN_KEY,
    USC_PROVER_API_URL,
    30000
  );

  const started = Date.now();
  onProgress?.(`Waiting for Creditcoin to attest Sepolia block ${blockHeight}`);

  while (true) {
    if (Date.now() - started > WAIT_TIMEOUT_MS) {
      throw new Error(`Timeout waiting for height ${blockHeight} to be attested`);
    }

    let latest: number | null = null;
    try {
      latest = await queryAttestedHeight();
    } catch (err) {
      console.warn('[Prover] attested-height query failed, retrying', err);
    }

    if (latest != null && latest >= blockHeight) {
      onProgress?.(`Sepolia block ${blockHeight} attested. Fetching proof...`);
      break;
    }

    const behind = latest == null ? '...' : String(blockHeight - latest);
    const latestLabel = latest == null ? '...' : String(latest);
    onProgress?.(
      `Creditcoin attested ${latestLabel} / ${blockHeight}. ${behind} block${behind === '1' ? '' : 's'} behind.`
    );
    console.log(
      `[Prover] Height ${blockHeight} not yet attested. Latest: ${latestLabel}. Retrying in ${POLL_MS}ms`
    );
    await sleep(POLL_MS);
  }

  const tryProof = async () => proofBuilder.getProof(transactionHash);

  let result: proofProvider.ProofResult;
  try {
    result = await tryProof();
  } catch {
    await sleep(EXTRA_DELAY_MS);
    result = await tryProof();
  }

  if (!result || !result.success || !result.data) {
    await sleep(EXTRA_DELAY_MS);
    result = await tryProof();
  }

  if (!result || !result.success || !result.data) {
    const errorMsg = result?.error || 'USC Prover service returned no proof data';
    console.error(`[Prover] Proof generation failed: ${errorMsg}`);
    throw new Error(`USC Prover failed: ${errorMsg}`);
  }

  const proofData: proofProvider.ContinuityResponse = result.data;
  console.log(`[Prover] Proof received successfully. Height: ${proofData.headerNumber}, txIndex: ${proofData.txIndex}`);

  return {
    height: BigInt(proofData.headerNumber),
    encodedTx: proofData.txBytes,
    merkleProof: {
      root: proofData.merkleProof.root,
      siblings: proofData.merkleProof.siblings.map((s: any) => ({
        hash: s.hash,
        isLeft: Boolean(s.isLeft),
      })),
    },
    continuityProof: {
      lowerEndpointDigest: proofData.continuityProof.lowerEndpointDigest,
      roots: proofData.continuityProof.roots,
    },
  };
}
