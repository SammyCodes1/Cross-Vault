// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

struct MerkleProofEntry {
    bytes32 hash;
    bool isLeft;
}

struct MerkleProof {
    bytes32 root;
    MerkleProofEntry[] siblings;
}

struct ContinuityProof {
    bytes32 lowerEndpointDigest;
    bytes32[] roots;
}

struct TxProof {
    uint64 height;
    bytes encodedTx;
    MerkleProof merkleProof;
    ContinuityProof continuityProof;
}

interface IBlockProver {
    event TransactionVerified(
        uint64 indexed chainKey,
        uint64 indexed height,
        uint64 transactionIndex
    );

    function calculateTxIndex(
        MerkleProof calldata merkleProof
    ) external view returns (uint64 transactionIndex);

    function verify(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external view returns (bool success);

    function verifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external returns (bool success);

    function verify(
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata encodedTransactions,
        MerkleProof[] calldata merkleProofs,
        ContinuityProof calldata sharedContinuityProof
    ) external view returns (bool success);

    function verifyAndEmit(
        uint64 chainKey,
        uint64[] calldata heights,
        bytes[] calldata encodedTransactions,
        MerkleProof[] calldata merkleProofs,
        ContinuityProof calldata sharedContinuityProof
    ) external returns (bool success);
}
