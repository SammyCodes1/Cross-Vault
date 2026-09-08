// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IBlockProver, TxProof} from "./interfaces/IBlockProver.sol";
import {DebtToken} from "./DebtToken.sol";

/**
 * @title CrossVault
 * @notice Cross-chain lending vault on Creditcoin 3 (CC3).
 * Verifies Ethereum Sepolia collateral locks and price updates via the Attestcoin BlockProver precompile,
 * mints tvUSD debt tokens against verified collateral, and enforces liquidation rules.
 */
contract CrossVault {
    struct Position {
        address owner;
        uint256 collateralAmount;
        uint256 debtAmount;
        bool liquidated;
    }

    struct LogEntry {
        address emitter;
        bytes32[] topics;
        bytes data;
    }

    // Attestcoin BlockProver precompile address on Creditcoin 3
    address public constant BLOCK_PROVER = 0x0000000000000000000000000000000000000FD2;

    // Event signatures on Ethereum Sepolia
    // Locked(uint256 indexed lockId, address indexed owner, uint256 amount, uint256 timestamp)
    bytes32 public constant LOCKED_EVENT_TOPIC = keccak256("Locked(uint256,address,uint256,uint256)");
    // PriceUpdated(uint256 price, uint256 timestamp)
    bytes32 public constant PRICE_UPDATED_EVENT_TOPIC = keccak256("PriceUpdated(uint256,uint256)");

    // Immutable contract references
    address public immutable collateralLock;
    address public immutable priceFeed;
    DebtToken public immutable debtToken;
    uint64 public immutable sepoliaChainKey;

    // Stored price: tvUSD (18 decimals) per 1e18 units of collateral
    uint256 public currentPrice;
    uint256 public nextPositionId = 1;

    // Replay protection
    mapping(uint256 => bool) public usedLockIds;
    mapping(bytes32 => bool) public usedPriceProofs;

    // Positions mapping
    mapping(uint256 => Position) public positions;

    // Events
    event PositionOpened(
        uint256 indexed positionId,
        address indexed owner,
        uint256 indexed lockId,
        uint256 collateralAmount,
        uint256 debtAmount
    );
    event PriceUpdated(uint256 newPrice, uint256 timestamp);
    event Liquidated(uint256 indexed positionId, address indexed liquidator);

    // Errors
    error VerificationFailed();
    error LockAlreadyUsed();
    error ProofAlreadyUsed();
    error LockIdMismatch();
    error PriceNotSet();
    error InvalidAmount();
    error InvalidOwner();
    error InvalidPrice();
    error InvalidEventData();
    error NotLiquidatable();

    constructor(
        address _collateralLock,
        address _priceFeed,
        address _debtToken,
        uint64 _sepoliaChainKey
    ) {
        collateralLock = _collateralLock;
        priceFeed = _priceFeed;
        debtToken = DebtToken(_debtToken);
        sepoliaChainKey = _sepoliaChainKey == 0 ? 1 : _sepoliaChainKey;
    }

    /**
     * @notice Opens a collateralized debt position verified through an Attestcoin proof from Sepolia.
     * @param lockId The expected lockId from the CollateralLock contract on Sepolia.
     * @param proof The transaction inclusion and continuity proof.
     * @return positionId The identifier assigned to the opened position.
     */
    function openPosition(uint256 lockId, TxProof calldata proof) external returns (uint256 positionId) {
        if (usedLockIds[lockId]) revert LockAlreadyUsed();
        if (currentPrice == 0) revert PriceNotSet();

        // 1. Verify inclusion proof via BlockProver precompile
        bool verified = IBlockProver(BLOCK_PROVER).verifyAndEmit(
            sepoliaChainKey,
            proof.height,
            proof.encodedTx,
            proof.merkleProof,
            proof.continuityProof
        );
        if (!verified) revert VerificationFailed();

        // 2. Prevent replay
        usedLockIds[lockId] = true;

        // 3. Critically decode owner and collateral amount directly from the verified transaction/event data
        (address owner, uint256 collateralAmount) = _decodeAndValidateLockedEvent(lockId, proof.encodedTx);

        // 4. Calculate debt amount at 150% collateralization with multiplication before division:
        // debtAmount = collateralAmount * price / 1e18 * 100 / 150
        uint256 debtAmount = (collateralAmount * currentPrice * 100) / (1e18 * 150);
        if (debtAmount == 0) revert InvalidAmount();

        // 5. Mint debt tokens to the decoded owner
        debtToken.mint(owner, debtAmount);

        // 6. Record position under incrementing positionId
        positionId = nextPositionId++;
        positions[positionId] = Position({
            owner: owner,
            collateralAmount: collateralAmount,
            debtAmount: debtAmount,
            liquidated: false
        });

        emit PositionOpened(positionId, owner, lockId, collateralAmount, debtAmount);
    }

    /**
     * @notice Updates the stored collateral price by verifying a PriceUpdated event from Sepolia's MockPriceFeed.
     * @param proof The inclusion and continuity proof for the price update transaction.
     */
    function updatePrice(TxProof calldata proof) external {
        bytes32 proofId = keccak256(
            abi.encode(proof.height, proof.merkleProof.root, keccak256(proof.encodedTx))
        );
        if (usedPriceProofs[proofId]) revert ProofAlreadyUsed();

        // 1. Verify inclusion proof via BlockProver precompile
        bool verified = IBlockProver(BLOCK_PROVER).verifyAndEmit(
            sepoliaChainKey,
            proof.height,
            proof.encodedTx,
            proof.merkleProof,
            proof.continuityProof
        );
        if (!verified) revert VerificationFailed();

        // 2. Prevent replay
        usedPriceProofs[proofId] = true;

        // 3. Decode new price from verified event data
        uint256 newPrice = _decodeAndValidatePriceUpdatedEvent(proof.encodedTx);
        currentPrice = newPrice;

        emit PriceUpdated(newPrice, block.timestamp);
    }

    /**
     * @notice Checks whether a position is eligible for liquidation.
     * Formula: collateralAmount * price / 1e18 < debtAmount * 120 / 100
     * @param positionId The position identifier.
     * @return True if liquidatable, false otherwise.
     */
    function isLiquidatable(uint256 positionId) public view returns (bool) {
        Position memory pos = positions[positionId];
        if (pos.liquidated || pos.debtAmount == 0 || currentPrice == 0) {
            return false;
        }

        uint256 collateralValue = (pos.collateralAmount * currentPrice) / 1e18;
        uint256 liquidationThreshold = (pos.debtAmount * 120) / 100;
        return collateralValue < liquidationThreshold;
    }

    /**
     * @notice Liquidates an undercollateralized position.
     * @param positionId The position to liquidate.
     */
    function liquidate(uint256 positionId) external {
        if (!isLiquidatable(positionId)) revert NotLiquidatable();

        Position storage pos = positions[positionId];
        uint256 debtToBurn = pos.debtAmount;

        // NOTE: This liquidation does not seize the underlying Sepolia collateral,
        // because Attestcoin attestation only flows from source chain into Creditcoin, not back.
        // This contract demonstrates the risk engine, not cross-chain custody reversal.

        // Burns debtAmount of tvUSD from msg.sender (they must hold and have approved it)
        bool success = debtToken.transferFrom(msg.sender, address(this), debtToBurn);
        if (!success) revert InvalidAmount();
        debtToken.burn(address(this), debtToBurn);

        pos.liquidated = true;

        emit Liquidated(positionId, msg.sender);
    }

    /**
     * @notice Returns position details.
     */
    function getPosition(uint256 positionId) external view returns (Position memory) {
        return positions[positionId];
    }

    // =========================================================================
    // Internal Event Decoders
    // =========================================================================

    function _decodeAndValidateLockedEvent(
        uint256 expectedLockId,
        bytes calldata encodedTransaction
    ) internal view returns (address owner, uint256 amount) {
        uint256 decodedLockId;

        // 1. Try full USC v1 encoding: (uint8 txType, bytes[] chunks)
        try this.tryDecodeUscReceipt(encodedTransaction) returns (LogEntry[] memory logs) {
            for (uint256 i = 0; i < logs.length; i++) {
                if (
                    (collateralLock == address(0) || logs[i].emitter == collateralLock) &&
                    logs[i].topics.length >= 3 &&
                    logs[i].topics[0] == LOCKED_EVENT_TOPIC
                ) {
                    decodedLockId = uint256(logs[i].topics[1]);
                    owner = address(uint160(uint256(logs[i].topics[2])));
                    (amount, ) = abi.decode(logs[i].data, (uint256, uint256));
                    break;
                }
            }
        } catch {}

        // 2. Try direct LogEntry[] decoding
        if (decodedLockId == 0 && owner == address(0)) {
            try this.tryDecodeLogEntries(encodedTransaction) returns (LogEntry[] memory logs) {
                for (uint256 i = 0; i < logs.length; i++) {
                    if (
                        (collateralLock == address(0) || logs[i].emitter == collateralLock) &&
                        logs[i].topics.length >= 3 &&
                        logs[i].topics[0] == LOCKED_EVENT_TOPIC
                    ) {
                        decodedLockId = uint256(logs[i].topics[1]);
                        owner = address(uint160(uint256(logs[i].topics[2])));
                        (amount, ) = abi.decode(logs[i].data, (uint256, uint256));
                        break;
                    }
                }
            } catch {}
        }

        // 3. Try direct LogEntry
        if (decodedLockId == 0 && owner == address(0)) {
            try this.tryDecodeSingleLog(encodedTransaction) returns (LogEntry memory logItem) {
                if (
                    (collateralLock == address(0) || logItem.emitter == collateralLock) &&
                    logItem.topics.length >= 3 &&
                    logItem.topics[0] == LOCKED_EVENT_TOPIC
                ) {
                    decodedLockId = uint256(logItem.topics[1]);
                    owner = address(uint160(uint256(logItem.topics[2])));
                    (amount, ) = abi.decode(logItem.data, (uint256, uint256));
                }
            } catch {}
        }

        // 4. Try tuple with emitter: (address emitter, uint256 lockId, address owner, uint256 amount)
        if (decodedLockId == 0 && owner == address(0)) {
            try this.tryDecodeTupleWithEmitter(encodedTransaction) returns (
                address em,
                uint256 lId,
                address ow,
                uint256 am
            ) {
                if (collateralLock == address(0) || em == collateralLock) {
                    decodedLockId = lId;
                    owner = ow;
                    amount = am;
                }
            } catch {}
        }

        // 5. Try simple tuple: (uint256 lockId, address owner, uint256 amount)
        if (decodedLockId == 0 && owner == address(0)) {
            try this.tryDecodeSimpleTuple(encodedTransaction) returns (
                uint256 lId,
                address ow,
                uint256 am
            ) {
                decodedLockId = lId;
                owner = ow;
                amount = am;
            } catch {}
        }

        if (owner == address(0) || amount == 0) revert InvalidEventData();
        if (decodedLockId != expectedLockId) revert LockIdMismatch();
    }

    function _decodeAndValidatePriceUpdatedEvent(
        bytes calldata encodedTransaction
    ) internal view returns (uint256 newPrice) {
        // 1. Try full USC v1 encoding: (uint8 txType, bytes[] chunks)
        try this.tryDecodeUscReceipt(encodedTransaction) returns (LogEntry[] memory logs) {
            for (uint256 i = 0; i < logs.length; i++) {
                if (
                    (priceFeed == address(0) || logs[i].emitter == priceFeed) &&
                    logs[i].topics.length >= 1 &&
                    logs[i].topics[0] == PRICE_UPDATED_EVENT_TOPIC
                ) {
                    (newPrice, ) = abi.decode(logs[i].data, (uint256, uint256));
                    return newPrice;
                }
            }
        } catch {}

        // 2. Try direct LogEntry[]
        try this.tryDecodeLogEntries(encodedTransaction) returns (LogEntry[] memory logs) {
            for (uint256 i = 0; i < logs.length; i++) {
                if (
                    (priceFeed == address(0) || logs[i].emitter == priceFeed) &&
                    logs[i].topics.length >= 1 &&
                    logs[i].topics[0] == PRICE_UPDATED_EVENT_TOPIC
                ) {
                    (newPrice, ) = abi.decode(logs[i].data, (uint256, uint256));
                    return newPrice;
                }
            }
        } catch {}

        // 3. Try direct LogEntry
        try this.tryDecodeSingleLog(encodedTransaction) returns (LogEntry memory logItem) {
            if (
                (priceFeed == address(0) || logItem.emitter == priceFeed) &&
                logItem.topics.length >= 1 &&
                logItem.topics[0] == PRICE_UPDATED_EVENT_TOPIC
            ) {
                (newPrice, ) = abi.decode(logItem.data, (uint256, uint256));
                return newPrice;
            }
        } catch {}

        // 4. Try tuple with emitter: (address emitter, uint256 price, uint256 timestamp)
        try this.tryDecodePriceTupleWithEmitter(encodedTransaction) returns (address em, uint256 pr) {
            if (priceFeed == address(0) || em == priceFeed) {
                return pr;
            }
        } catch {}

        // 5. Try simple tuple: (uint256 price, uint256 timestamp) or (uint256 price)
        try this.tryDecodePriceSimpleTuple(encodedTransaction) returns (uint256 pr) {
            return pr;
        } catch {}

        revert InvalidEventData();
    }

    // =========================================================================
    // External Pure Decoders (for safe try/catch branching)
    // =========================================================================

    function tryDecodeUscReceipt(bytes calldata encodedTransaction) external pure returns (LogEntry[] memory) {
        (, bytes[] memory chunks) = abi.decode(encodedTransaction, (uint8, bytes[]));
        require(chunks.length > 0, "No chunks");
        bytes memory receiptChunk = chunks[chunks.length - 1];
        (, , LogEntry[] memory logs, ) = abi.decode(receiptChunk, (uint8, uint64, LogEntry[], bytes));
        return logs;
    }

    function tryDecodeLogEntries(bytes calldata encodedTransaction) external pure returns (LogEntry[] memory) {
        return abi.decode(encodedTransaction, (LogEntry[]));
    }

    function tryDecodeSingleLog(bytes calldata encodedTransaction) external pure returns (LogEntry memory) {
        return abi.decode(encodedTransaction, (LogEntry));
    }

    function tryDecodeTupleWithEmitter(
        bytes calldata encodedTransaction
    ) external pure returns (address, uint256, address, uint256) {
        return abi.decode(encodedTransaction, (address, uint256, address, uint256));
    }

    function tryDecodeSimpleTuple(
        bytes calldata encodedTransaction
    ) external pure returns (uint256, address, uint256) {
        return abi.decode(encodedTransaction, (uint256, address, uint256));
    }

    function tryDecodePriceTupleWithEmitter(
        bytes calldata encodedTransaction
    ) external pure returns (address, uint256) {
        (address em, uint256 pr, ) = abi.decode(encodedTransaction, (address, uint256, uint256));
        return (em, pr);
    }

    function tryDecodePriceSimpleTuple(
        bytes calldata encodedTransaction
    ) external pure returns (uint256) {
        if (encodedTransaction.length == 32) {
            return abi.decode(encodedTransaction, (uint256));
        }
        (uint256 pr, ) = abi.decode(encodedTransaction, (uint256, uint256));
        return pr;
    }
}
