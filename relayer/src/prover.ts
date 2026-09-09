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

/**
 * Requests an inclusion and continuity proof for a confirmed Sepolia transaction from the USC Prover API.
 * Follows the exact SDK calls verified in ATTESTCOIN_INTERFACE.md.
 */
export async function fetchSepoliaProof(
  transactionHash: string,
  blockHeight: number,
  timeoutMs: number = 900000 // 15 minutes max wait
): Promise<TxProofPayload> {
  console.log(`[Prover] Initializing ProofBuilder for chain ${SEPOLIA_CHAIN_KEY} at ${USC_PROVER_API_URL}`);
  const proofBuilder = new proofProvider.service.ProofBuilder(
    SEPOLIA_CHAIN_KEY,
    USC_PROVER_API_URL,
    30000 // 30s HTTP request timeout
  );

  console.log(`[Prover] Waiting for Sepolia block ${blockHeight} to be attested on CC3...`);
  await proofBuilder.waitUntilHeightAttested(
    SEPOLIA_CHAIN_KEY,
    blockHeight,
    5000, // 5s poll interval
    timeoutMs
  );

  console.log(`[Prover] Requesting proof for tx ${transactionHash}...`);
  const result: proofProvider.ProofResult = await proofBuilder.getProof(transactionHash);

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
