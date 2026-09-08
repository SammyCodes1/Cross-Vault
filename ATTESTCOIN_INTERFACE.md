# Attestcoin / USC Verification Interface Specification

## 1. Source Verification Summary

This document specifies the exact on-chain Solidity interface and off-chain relayer SDK types for Creditcoin 3's Universal Smart Contract (USC) / Attestcoin transaction verifier precompile.

These definitions were verified from two authoritative sources:
1. **Direct SDK Inspection**: `@gluwa/usc-sdk` installed in `relayer/node_modules/@gluwa/usc-sdk`, including `src/block-prover/block_prover.json` (ABI), `src/block-prover/index.ts`, `src/proof-provider/service/index.ts`, and `src/proof-provider/merkle.ts`.
2. **Precompile Source Code**: Official Gluwa Creditcoin 3 Rust precompile repository (`precompiles/block-prover/src/lib.rs` and `verify.rs`), confirming dispatch signatures and internal gas mechanics.

---

## 2. On-Chain Constants

| Parameter | Value | Description |
| :--- | :--- | :--- |
| **Precompile Address** | `0x0000000000000000000000000000000000000FD2` | Block Prover / Native Query Verifier precompile on Creditcoin 3 (CC3) |
| **ChainInfo Address** | `0x0000000000000000000000000000000000000FD3` | Precompile for chain info and attestation bounds query |
| **Chain Key (Sepolia)**| `1` | Source chain identifier on CC3 for Ethereum Sepolia testnet |

---

## 3. Concrete Solidity Structs & Interface

These exact structs and interface signatures are designed to be imported directly by `CrossVault.sol` in `contracts-creditcoin`.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice A single sibling entry in a Merkle proof path
struct MerkleProofEntry {
    bytes32 hash;
    bool isLeft;
}

/// @notice Merkle proof of transaction inclusion within a block
struct MerkleProof {
    bytes32 root;
    MerkleProofEntry[] siblings;
}

/// @notice Continuity proof linking a block to an attested checkpoint
struct ContinuityProof {
    bytes32 lowerEndpointDigest;
    bytes32[] roots;
}

/**
 * @title IBlockProver
 * @notice Interface for the Creditcoin 3 Block Prover precompile located at 0x0000000000000000000000000000000000000FD2
 */
interface IBlockProver {
    /// @notice Emitted when a transaction inclusion proof is successfully verified
    event TransactionVerified(
        uint64 indexed chainKey,
        uint64 indexed height,
        uint64 transactionIndex
    );

    /**
     * @notice Reconstructs the leaf index (transaction index) from Merkle proof siblings.
     * @param merkleProof Merkle proof containing root and sibling entries.
     * @return transactionIndex The leaf position (index) of the transaction in the block.
     */
    function calculateTxIndex(
        MerkleProof calldata merkleProof
    ) external view returns (uint64 transactionIndex);

    /**
     * @notice Verifies single transaction inclusion and block continuity (read-only view, no events emitted).
     * @param chainKey Source chain identifier (1 for Ethereum Sepolia).
     * @param height Source chain block height of the transaction.
     * @param encodedTransaction Encoded transaction bytes.
     * @param merkleProof Merkle proof of transaction inclusion in the block.
     * @param continuityProof Proof linking the block to an attested checkpoint on CC3.
     * @return success True if verification succeeds, reverts otherwise.
     */
    function verify(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external view returns (bool success);

    /**
     * @notice Verifies single transaction inclusion, emits TransactionVerified event, and reverts on failure.
     * @param chainKey Source chain identifier (1 for Ethereum Sepolia).
     * @param height Source chain block height of the transaction.
     * @param encodedTransaction Encoded transaction bytes.
     * @param merkleProof Merkle proof of transaction inclusion in the block.
     * @param continuityProof Proof linking the block to an attested checkpoint on CC3.
     * @return success True if verification succeeds, reverts otherwise.
     */
    function verifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external returns (bool success);

    /**
     * @notice Batch verification view function using a shared continuity proof.
     */
    function verify(
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata encodedTransactions,
        MerkleProof[] calldata merkleProofs,
        ContinuityProof calldata sharedContinuityProof
    ) external view returns (bool success);

    /**
     * @notice Batch verification stateful function emitting TransactionVerified events.
     */
    function verifyAndEmit(
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata encodedTransactions,
        MerkleProof[] calldata merkleProofs,
        ContinuityProof calldata sharedContinuityProof
    ) external returns (bool success);
}
```

---

## 4. Relayer-Side SDK Calls (`@gluwa/usc-sdk`)

The relayer queries the USC prover service via `ProofBuilder` to generate proofs for confirmed Sepolia transactions before calling `CrossVault.sol` (or the precompile directly).

### Exact TypeScript SDK Implementation

```typescript
import { proofProvider, blockProver } from '@gluwa/usc-sdk';
import { JsonRpcProvider, Wallet } from 'ethers';

// Configuration
const SEPOLIA_CHAIN_KEY = 1;
const PROVER_API_URL = process.env.USC_PROVER_API_URL || 'https://prover.cc3-testnet.creditcoin.network';
const CC3_RPC_URL = process.env.CC3_TESTNET_RPC_URL || 'https://rpc.cc3-testnet.creditcoin.network';
const CC3_PRIVATE_KEY = process.env.CC3_PRIVATE_KEY!;

/**
 * Fetches an inclusion & continuity proof for a confirmed Sepolia transaction.
 *
 * @param transactionHash - The transaction hash on Ethereum Sepolia (hex string '0x...')
 * @param blockHeight - The block number where the Sepolia transaction was mined
 * @returns The verified proof data ready for on-chain submission
 */
export async function fetchSepoliaProof(transactionHash: string, blockHeight: number) {
  // 1. Initialize ProofBuilder with Sepolia chainKey (1) and Prover API URL
  const proofBuilder = new proofProvider.service.ProofBuilder(
    SEPOLIA_CHAIN_KEY,
    PROVER_API_URL,
    15000 // 15s timeout
  );

  // 2. Wait until Creditcoin has attested the block height (prevents premature queries)
  console.log(`Waiting for Sepolia block ${blockHeight} to be attested on CC3...`);
  await proofBuilder.waitUntilHeightAttested(
    SEPOLIA_CHAIN_KEY,
    blockHeight,
    15000, // pollIntervalMs (15s)
    900000 // waitTimeoutMs (15m)
  );

  // 3. Request proof from Prover API
  // Endpoint called: GET /api/v1/proof-by-tx/1/<transactionHash>
  const result: proofProvider.ProofResult = await proofBuilder.getProof(transactionHash);

  if (!result.success || !result.data) {
    throw new Error(`USC Prover failed to generate proof: ${result.error}`);
  }

  const proofData: proofProvider.ContinuityResponse = result.data;

  // Extracted fields matching Solidity structs:
  return {
    chainKey: proofData.chainKey,         // uint64 (1)
    height: proofData.headerNumber,       // uint64 (source block height)
    txIndex: proofData.txIndex,           // uint64
    txHash: proofData.txHash,             // string '0x...'
    encodedTx: proofData.txBytes,         // bytes '0x...'
    merkleProof: {
      root: proofData.merkleProof.root,   // bytes32
      siblings: proofData.merkleProof.siblings.map((s) => ({
        hash: s.hash,                     // bytes32
        isLeft: s.isLeft                  // bool
      }))
    },
    continuityProof: {
      lowerEndpointDigest: proofData.continuityProof.lowerEndpointDigest, // bytes32
      roots: proofData.continuityProof.roots                              // bytes32[]
    }
  };
}

/**
 * Example of on-chain verification using PrecompileBlockProver helper.
 */
export async function verifyProofOnCreditcoin(proofPayload: Awaited<ReturnType<typeof fetchSepoliaProof>>) {
  const cc3Provider = new JsonRpcProvider(CC3_RPC_URL);
  const signer = new Wallet(CC3_PRIVATE_KEY, cc3Provider);

  // Default address is 0x0000000000000000000000000000000000000FD2
  const prover = new blockProver.PrecompileBlockProver(cc3Provider);

  // Execute on-chain verification transaction
  const tx = await prover.verifyAndEmitSingle(
    signer,
    proofPayload.chainKey,
    proofPayload.height,
    proofPayload.encodedTx,
    proofPayload.merkleProof,
    proofPayload.continuityProof
  );

  const receipt = await tx.wait();
  return receipt;
}
```

---

## 5. Usage in `CrossVault.sol` (Creditcoin-Side)

When `CrossVault.sol` is deployed to Creditcoin:
1. It references `IBlockProver(0x0000000000000000000000000000000000000FD2)`.
2. When a relayer or user submits a lock proof from Sepolia:
   ```solidity
   IBlockProver(0x0000000000000000000000000000000000000FD2).verifyAndEmit(
       chainKey, // 1 for Sepolia
       height,
       encodedTransaction,
       merkleProof,
       continuityProof
   );
   ```
3. If valid, the precompile executes without revert and emits `TransactionVerified(chainKey, height, txIndex)`.
4. `CrossVault.sol` marks the proof as processed (preventing replay attacks) and executes corresponding mint or release logic.
