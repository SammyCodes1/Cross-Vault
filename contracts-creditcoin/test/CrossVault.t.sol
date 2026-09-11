// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {CrossVault} from "../src/CrossVault.sol";
import {DebtToken} from "../src/DebtToken.sol";
import {IBlockProver, MerkleProof, MerkleProofEntry, ContinuityProof, TxProof} from "../src/interfaces/IBlockProver.sol";

contract CrossVaultTest is Test {
    CrossVault public crossVault;
    DebtToken public debtToken;

    address public constant BLOCK_PROVER = 0x0000000000000000000000000000000000000FD2;
    address public collateralLock = address(0x1001);
    address public priceFeed = address(0x2002);
    uint64 public sepoliaChainKey = 1;

    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);

    event PositionOpened(
        uint256 indexed positionId,
        address indexed owner,
        uint256 indexed lockId,
        uint256 collateralAmount,
        uint256 debtAmount
    );
    event PriceUpdated(uint256 newPrice, uint256 timestamp);
    event Liquidated(uint256 indexed positionId, address indexed liquidator);

    bytes4 internal constant VERIFY_AND_EMIT_SELECTOR =
        bytes4(keccak256("verifyAndEmit(uint64,uint64,bytes,(bytes32,(bytes32,bool)[]),(bytes32,bytes32[]))"));

    function setUp() public {
        // Deploy DebtToken with unset vault initially
        debtToken = new DebtToken(address(0));

        // Deploy CrossVault with Sepolia parameters
        crossVault = new CrossVault(collateralLock, priceFeed, address(debtToken), sepoliaChainKey);

        // Bind CrossVault as authorized minter/burner for DebtToken
        debtToken.setVault(address(crossVault));

        // Default: Mock BlockProver precompile returning true on verifyAndEmit
        vm.mockCall(
            BLOCK_PROVER,
            abi.encodeWithSelector(VERIFY_AND_EMIT_SELECTOR),
            abi.encode(true)
        );
    }

    // =========================================================================
    // Proof Helper Utilities
    // =========================================================================

    function _createPriceUpdateProof(uint256 newPrice, uint64 height) internal view returns (TxProof memory) {
        bytes memory encodedTx = abi.encode(priceFeed, newPrice, block.timestamp);
        MerkleProof memory mp = MerkleProof({
            root: keccak256(abi.encodePacked("price-root", newPrice, height)),
            siblings: new MerkleProofEntry[](0)
        });
        ContinuityProof memory cp = ContinuityProof({
            lowerEndpointDigest: bytes32(0),
            roots: new bytes32[](0)
        });
        return TxProof({
            height: height,
            encodedTx: encodedTx,
            merkleProof: mp,
            continuityProof: cp
        });
    }

    function _createLockProof(
        uint256 lockId,
        address owner,
        uint256 amount,
        uint64 height
    ) internal view returns (TxProof memory) {
        bytes memory encodedTx = abi.encode(collateralLock, lockId, owner, amount);
        MerkleProof memory mp = MerkleProof({
            root: keccak256(abi.encodePacked("lock-root", lockId, owner, amount)),
            siblings: new MerkleProofEntry[](0)
        });
        ContinuityProof memory cp = ContinuityProof({
            lowerEndpointDigest: bytes32(0),
            roots: new bytes32[](0)
        });
        return TxProof({
            height: height,
            encodedTx: encodedTx,
            merkleProof: mp,
            continuityProof: cp
        });
    }

    function _createUscV1LockProof(
        uint256 lockId,
        address owner,
        uint256 amount,
        uint64 height
    ) internal view returns (TxProof memory) {
        CrossVault.LogEntry[] memory logs = new CrossVault.LogEntry[](1);
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = crossVault.LOCKED_EVENT_TOPIC();
        topics[1] = bytes32(lockId);
        topics[2] = bytes32(uint256(uint160(owner)));
        logs[0] = CrossVault.LogEntry({
            emitter: collateralLock,
            topics: topics,
            data: abi.encode(amount, block.timestamp)
        });

        bytes memory receiptChunk = abi.encode(uint8(1), uint64(50000), logs, hex"00");
        bytes[] memory chunks = new bytes[](2);
        chunks[0] = hex"12345678";
        chunks[1] = receiptChunk;
        bytes memory encodedTx = abi.encode(uint8(2), chunks);

        MerkleProof memory mp = MerkleProof({
            root: keccak256(abi.encodePacked("usc-lock-root", lockId)),
            siblings: new MerkleProofEntry[](0)
        });
        ContinuityProof memory cp = ContinuityProof({
            lowerEndpointDigest: bytes32(0),
            roots: new bytes32[](0)
        });

        return TxProof({
            height: height,
            encodedTx: encodedTx,
            merkleProof: mp,
            continuityProof: cp
        });
    }

    // =========================================================================
    // Test Cases
    // =========================================================================

    /**
     * @notice Test 1: Successful open with a concrete numeric example asserted exactly.
     * Concrete Example:
     * - Collateral: 2.5 ether (2.5e18 mWETH)
     * - Stored Price: 3,000 ether (3000e18 tvUSD per 1e18 mWETH collateral)
     * - Collateralization Ratio: 150%
     * - Expected Debt Formula: debtAmount = (collateralAmount * price * 100) / (1e18 * 150)
     * - Calculation: (2.5e18 * 3000e18 * 100) / (1e18 * 150) = 750,000e36 / 150e18 = 5,000e18 tvUSD (5,000 tvUSD)
     * - Result: Collateral Value = $7,500, Debt = $5,000 (Exactly 150% collateral ratio)
     */
    function test_OpenPosition_ConcreteNumericExample() public {
        // Step 1: Set price to 3000 tvUSD per collateral unit
        TxProof memory priceProof = _createPriceUpdateProof(3000 ether, 100);
        crossVault.updatePrice(priceProof);
        assertEq(crossVault.currentPrice(), 3000 ether);

        // Step 2: Prepare lock proof for Alice with 2.5 ether collateral under lockId 1
        uint256 lockId = 1;
        uint256 collateralAmount = 2.5 ether;
        TxProof memory lockProof = _createLockProof(lockId, alice, collateralAmount, 101);

        // Expected exact debtAmount calculated by formula:
        uint256 expectedDebt = 5000 ether;

        vm.expectEmit(true, true, true, true);
        emit PositionOpened(1, alice, lockId, collateralAmount, expectedDebt);

        uint256 positionId = crossVault.openPosition(lockId, lockProof);

        assertEq(positionId, 1);
        assertEq(crossVault.nextPositionId(), 2);

        // Verify position storage
        CrossVault.Position memory pos = crossVault.getPosition(1);
        assertEq(pos.owner, alice);
        assertEq(pos.collateralAmount, 2.5 ether);
        assertEq(pos.debtAmount, expectedDebt, "Expected exactly 5000 tvUSD debt for 2.5 mWETH at $3000 price");
        assertFalse(pos.liquidated);

        // Verify debt token was minted directly to the decoded owner (Alice)
        assertEq(debtToken.balanceOf(alice), expectedDebt);
    }

    /**
     * @notice Test 1b: Verify openPosition with real USC v1 chunk encoding format.
     */
    function test_OpenPosition_WithUscV1ReceiptEncoding() public {
        crossVault.updatePrice(_createPriceUpdateProof(2000 ether, 100));

        uint256 lockId = 42;
        uint256 collateralAmount = 1.5 ether;
        TxProof memory proof = _createUscV1LockProof(lockId, alice, collateralAmount, 102);

        // Expected debt: (1.5e18 * 2000e18 * 100) / (150e18) = 2000e18 tvUSD
        uint256 expectedDebt = 2000 ether;

        uint256 posId = crossVault.openPosition(lockId, proof);
        CrossVault.Position memory pos = crossVault.getPosition(posId);

        assertEq(pos.owner, alice);
        assertEq(pos.collateralAmount, collateralAmount);
        assertEq(pos.debtAmount, expectedDebt);
        assertEq(debtToken.balanceOf(alice), expectedDebt);
    }

    /**
     * @notice Test 2: Rejected duplicate proof.
     */
    function test_RevertWhen_DuplicateLockProofUsed() public {
        crossVault.updatePrice(_createPriceUpdateProof(3000 ether, 100));

        uint256 lockId = 1;
        TxProof memory lockProof = _createLockProof(lockId, alice, 1 ether, 101);

        // First open succeeds
        crossVault.openPosition(lockId, lockProof);

        // Replay attempt with same lockId must revert
        vm.expectRevert(CrossVault.LockAlreadyUsed.selector);
        crossVault.openPosition(lockId, lockProof);
    }

    /**
     * @notice Test 2b: Rejected duplicate price update proof.
     */
    function test_RevertWhen_DuplicatePriceProofUsed() public {
        TxProof memory priceProof = _createPriceUpdateProof(2500 ether, 100);
        crossVault.updatePrice(priceProof);

        // Replay same price proof must revert
        vm.expectRevert(CrossVault.ProofAlreadyUsed.selector);
        crossVault.updatePrice(priceProof);
    }

    /**
     * @notice Test 3: Rejected failed verification.
     */
    function test_RevertWhen_VerificationFails() public {
        crossVault.updatePrice(_createPriceUpdateProof(3000 ether, 100));

        // Mock BlockProver to return false (failed cryptographic proof verification)
        vm.mockCall(
            BLOCK_PROVER,
            abi.encodeWithSelector(VERIFY_AND_EMIT_SELECTOR),
            abi.encode(false)
        );

        TxProof memory lockProof = _createLockProof(1, alice, 1 ether, 101);

        vm.expectRevert(CrossVault.VerificationFailed.selector);
        crossVault.openPosition(1, lockProof);
    }

    /**
     * @notice Test 4: Price update verifies and updates currentPrice.
     */
    function test_UpdatePrice_HappyPath() public {
        assertEq(crossVault.currentPrice(), 0);

        TxProof memory proof1 = _createPriceUpdateProof(2800 ether, 100);
        vm.expectEmit(false, false, false, true);
        emit PriceUpdated(2800 ether, block.timestamp);

        crossVault.updatePrice(proof1);
        assertEq(crossVault.currentPrice(), 2800 ether);

        // Subsequent price update to $3200
        TxProof memory proof2 = _createPriceUpdateProof(3200 ether, 101);
        crossVault.updatePrice(proof2);
        assertEq(crossVault.currentPrice(), 3200 ether);
    }

    /**
     * @notice Test 5 & 6: Liquidation rejected before price drop, becoming possible after price drop.
     * Scenario:
     * - Alice deposits 2 ether collateral at initial price $3,000/ETH.
     * - Debt minted = (2e18 * 3000e18 * 100) / (150e18) = 4,000 tvUSD.
     * - Liquidation threshold = debtAmount * 120 / 100 = 4000 * 1.2 = 4,800 tvUSD.
     *
     * State A (Price = $3,000):
     * - Collateral Value = 2 * 3000 = $6,000.
     * - $6,000 >= $4,800 -> NOT liquidatable.
     * - Attempting liquidation must revert.
     *
     * State B (Price drops to $2,000):
     * - Collateral Value = 2 * 2000 = $4,000.
     * - $4,000 < $4,800 -> LIQUIDATABLE!
     * - Liquidation succeeds, burns debt from liquidator (Bob), marks liquidated.
     */
    function test_Liquidation_Lifecycle() public {
        // Step 1: Open position at $3,000 price
        crossVault.updatePrice(_createPriceUpdateProof(3000 ether, 100));

        uint256 positionId = crossVault.openPosition(
            1,
            _createLockProof(1, alice, 2 ether, 101)
        );

        CrossVault.Position memory pos = crossVault.getPosition(positionId);
        assertEq(pos.collateralAmount, 2 ether);
        assertEq(pos.debtAmount, 4000 ether);

        // Step 2: Liquidation rejected before price drop
        assertFalse(crossVault.isLiquidatable(positionId));

        // Bob has 4000 tvUSD from Alice
        vm.prank(alice);
        debtToken.transfer(bob, 4000 ether);

        vm.startPrank(bob);
        debtToken.approve(address(crossVault), 4000 ether);

        vm.expectRevert(CrossVault.NotLiquidatable.selector);
        crossVault.liquidate(positionId);
        vm.stopPrank();

        // Step 3: Price drops to $2,000
        crossVault.updatePrice(_createPriceUpdateProof(2000 ether, 102));
        assertEq(crossVault.currentPrice(), 2000 ether);

        // Now collateral value is $4,000 < liquidation threshold ($4,800)
        assertTrue(crossVault.isLiquidatable(positionId));

        // Step 4: Bob executes liquidation
        vm.startPrank(bob);
        vm.expectEmit(true, true, false, false);
        emit Liquidated(positionId, bob);

        crossVault.liquidate(positionId);
        vm.stopPrank();

        // Verify position is marked liquidated
        CrossVault.Position memory liquidatedPos = crossVault.getPosition(positionId);
        assertTrue(liquidatedPos.liquidated);

        // Verify Bob's tvUSD tokens were burned
        assertEq(debtToken.balanceOf(bob), 0);

        // Attempting to liquidate again must be rejected
        assertFalse(crossVault.isLiquidatable(positionId));
        vm.prank(bob);
        vm.expectRevert(CrossVault.NotLiquidatable.selector);
        crossVault.liquidate(positionId);
    }

    function test_Repay_ClosesPositionAndBurnsDebt() public {
        crossVault.updatePrice(_createPriceUpdateProof(3000 ether, 100));
        uint256 positionId = crossVault.openPosition(1, _createLockProof(1, alice, 2 ether, 101));

        vm.startPrank(alice);
        debtToken.approve(address(crossVault), 4000 ether);
        crossVault.repay(positionId);
        vm.stopPrank();

        CrossVault.Position memory pos = crossVault.getPosition(positionId);
        assertTrue(pos.repaid);
        assertFalse(pos.liquidated);
        assertEq(debtToken.balanceOf(alice), 0);
        assertFalse(crossVault.isLiquidatable(positionId));
    }

    function test_RevertWhen_NonOwnerRepays() public {
        crossVault.updatePrice(_createPriceUpdateProof(3000 ether, 100));
        uint256 positionId = crossVault.openPosition(1, _createLockProof(1, alice, 2 ether, 101));

        vm.prank(bob);
        vm.expectRevert(CrossVault.InvalidOwner.selector);
        crossVault.repay(positionId);
    }

    /**
     * @notice Test DebtToken access controls.
     */
    function test_DebtToken_AccessControl() public {
        vm.prank(alice);
        vm.expectRevert(DebtToken.Unauthorized.selector);
        debtToken.mint(alice, 100 ether);

        vm.prank(alice);
        vm.expectRevert(DebtToken.Unauthorized.selector);
        debtToken.burn(alice, 100 ether);

        vm.prank(alice);
        vm.expectRevert(DebtToken.Unauthorized.selector);
        debtToken.setVault(alice);
    }

    function test_DebtToken_SetVaultOnlyOnceByDeployer() public {
        DebtToken token = new DebtToken(address(0));

        vm.prank(alice);
        vm.expectRevert(DebtToken.Unauthorized.selector);
        token.setVault(alice);

        token.setVault(address(crossVault));
        assertEq(token.vault(), address(crossVault));

        vm.expectRevert(DebtToken.VaultAlreadySet.selector);
        token.setVault(address(1));
    }

    function test_RevertWhen_ConstructorZeroAddress() public {
        vm.expectRevert(CrossVault.ZeroAddress.selector);
        new CrossVault(address(0), priceFeed, address(debtToken), sepoliaChainKey);

        vm.expectRevert(CrossVault.ZeroAddress.selector);
        new CrossVault(collateralLock, address(0), address(debtToken), sepoliaChainKey);

        vm.expectRevert(CrossVault.ZeroAddress.selector);
        new CrossVault(collateralLock, priceFeed, address(0), sepoliaChainKey);
    }

    function test_RevertWhen_SimpleTupleLockProofRejected() public {
        crossVault.updatePrice(_createPriceUpdateProof(3000 ether, 100));

        TxProof memory junk = _createBareTupleLockProof(1, alice, 1 ether, 101);
        vm.expectRevert(CrossVault.InvalidEventData.selector);
        crossVault.openPosition(1, junk);
        assertFalse(crossVault.usedLockIds(1));
    }

    function test_RevertWhen_FailedDecodeDoesNotConsumeLockId() public {
        crossVault.updatePrice(_createPriceUpdateProof(3000 ether, 100));

        TxProof memory junk = _createBareTupleLockProof(1, alice, 1 ether, 101);
        vm.expectRevert(CrossVault.InvalidEventData.selector);
        crossVault.openPosition(1, junk);

        uint256 positionId = crossVault.openPosition(1, _createLockProof(1, alice, 1 ether, 102));
        assertEq(positionId, 1);
        assertEq(debtToken.balanceOf(alice), (1 ether * 3000 ether * 100) / (1e18 * 150));
    }

    function test_RevertWhen_LockProofWrongEmitter() public {
        crossVault.updatePrice(_createPriceUpdateProof(3000 ether, 100));

        bytes memory encodedTx = abi.encode(address(0xDEAD), uint256(1), alice, uint256(1 ether));
        TxProof memory proof = TxProof({
            height: 101,
            encodedTx: encodedTx,
            merkleProof: MerkleProof({root: keccak256("wrong-emitter"), siblings: new MerkleProofEntry[](0)}),
            continuityProof: ContinuityProof({lowerEndpointDigest: bytes32(0), roots: new bytes32[](0)})
        });

        vm.expectRevert(CrossVault.WrongContract.selector);
        crossVault.openPosition(1, proof);
        assertFalse(crossVault.usedLockIds(1));
    }

    function test_RevertWhen_SimpleTuplePriceProofRejected() public {
        bytes memory encodedTx = abi.encode(uint256(999 ether), block.timestamp);
        TxProof memory proof = TxProof({
            height: 100,
            encodedTx: encodedTx,
            merkleProof: MerkleProof({root: keccak256("bare-price"), siblings: new MerkleProofEntry[](0)}),
            continuityProof: ContinuityProof({lowerEndpointDigest: bytes32(0), roots: new bytes32[](0)})
        });

        vm.expectRevert(CrossVault.InvalidEventData.selector);
        crossVault.updatePrice(proof);
        assertEq(crossVault.currentPrice(), 0);
    }

    function test_RevertWhen_PriceProofWrongEmitter() public {
        TxProof memory proof = TxProof({
            height: 100,
            encodedTx: abi.encode(address(0xDEAD), uint256(999 ether), block.timestamp),
            merkleProof: MerkleProof({root: keccak256("wrong-price-emitter"), siblings: new MerkleProofEntry[](0)}),
            continuityProof: ContinuityProof({lowerEndpointDigest: bytes32(0), roots: new bytes32[](0)})
        });

        vm.expectRevert(CrossVault.WrongContract.selector);
        crossVault.updatePrice(proof);
    }

    function test_RevertWhen_ZeroPriceRejected() public {
        TxProof memory proof = _createPriceUpdateProof(0, 100);
        vm.expectRevert(CrossVault.InvalidPrice.selector);
        crossVault.updatePrice(proof);
        assertEq(crossVault.currentPrice(), 0);
    }

    function test_RevertWhen_PriceAboveMaxRejected() public {
        TxProof memory proof = _createPriceUpdateProof(1_000_000 ether + 1, 100);
        vm.expectRevert(CrossVault.InvalidPrice.selector);
        crossVault.updatePrice(proof);
    }

    function _createBareTupleLockProof(
        uint256 lockId,
        address owner,
        uint256 amount,
        uint64 height
    ) internal pure returns (TxProof memory) {
        return TxProof({
            height: height,
            encodedTx: abi.encode(lockId, owner, amount),
            merkleProof: MerkleProof({
                root: keccak256(abi.encodePacked("bare-lock", lockId)),
                siblings: new MerkleProofEntry[](0)
            }),
            continuityProof: ContinuityProof({lowerEndpointDigest: bytes32(0), roots: new bytes32[](0)})
        });
    }

    // =========================================================================
    // Pyth Network Attestation Tests
    // =========================================================================

    function _createPythPriceProof(
        address emitter,
        bytes32 feedId,
        int64 rawPrice,
        uint64 height
    ) internal view returns (TxProof memory) {
        bytes32[] memory topics = new bytes32[](2);
        topics[0] = crossVault.PYTH_PRICE_FEED_UPDATE_TOPIC();
        topics[1] = feedId;
        bytes memory eventData = abi.encode(uint64(block.timestamp), rawPrice, uint64(108116130));

        CrossVault.LogEntry[] memory logs = new CrossVault.LogEntry[](1);
        logs[0] = CrossVault.LogEntry({
            emitter: emitter,
            topics: topics,
            data: eventData
        });

        bytes memory encodedTx = abi.encode(logs);

        MerkleProof memory mp = MerkleProof({
            root: keccak256(abi.encodePacked("pyth-root", rawPrice, height)),
            siblings: new MerkleProofEntry[](0)
        });
        ContinuityProof memory cp = ContinuityProof({
            lowerEndpointDigest: bytes32(0),
            roots: new bytes32[](0)
        });
        return TxProof({
            height: height,
            encodedTx: encodedTx,
            merkleProof: mp,
            continuityProof: cp
        });
    }

    /**
     * @notice Tests successful Pyth price update with concrete numeric values:
     * - Raw Pyth price: 240000000000 (representing $2,400.00 with expo -8)
     * - Verified expo: -8
     * - Expected normalized 18-decimal price: 240000000000 * 10^(18 - 8) = 240000000000 * 1e10 = 2400 * 1e18 = 2400000000000000000000
     */
    function test_UpdatePriceFromPyth_Success_ConcreteNumericExample() public {
        address pythSepolia = crossVault.PYTH_CONTRACT_SEPOLIA();
        bytes32 pythFeedId = crossVault.PYTH_ETH_FEED_ID();

        // Concrete numeric test parameters:
        // Raw Pyth price: 240,000,000,000 ($2,400.00 USD at 8 decimals)
        // Expo: -8
        int64 rawPythPrice = 240000000000;
        uint256 expectedNormalizedPrice = 2400 ether; // 2400 * 1e18 = 2400000000000000000000

        TxProof memory proof = _createPythPriceProof(pythSepolia, pythFeedId, rawPythPrice, 100);

        // Expect events
        vm.expectEmit(false, false, false, true);
        emit PriceUpdated(expectedNormalizedPrice, block.timestamp);

        crossVault.updatePriceFromPyth(proof);

        // Verify stored price matches expected normalized value
        assertEq(crossVault.currentPrice(), expectedNormalizedPrice);
        assertEq(crossVault.currentPrice(), 2400000000000000000000);
        assertEq(crossVault.priceSource(), "Pyth");
    }

    /**
     * @notice Rejection test: Revert if Pyth proof points to wrong contract address on Sepolia.
     */
    function test_RevertWhen_PythProofWrongContractAddress() public {
        address fakePyth = address(0xDEADBEEF);
        bytes32 pythFeedId = crossVault.PYTH_ETH_FEED_ID();
        int64 rawPythPrice = 240000000000;

        TxProof memory proof = _createPythPriceProof(fakePyth, pythFeedId, rawPythPrice, 101);

        vm.expectRevert(CrossVault.WrongContract.selector);
        crossVault.updatePriceFromPyth(proof);
    }

    /**
     * @notice Rejection test: Revert if Pyth proof points to wrong price feed ID.
     */
    function test_RevertWhen_PythProofWrongFeedId() public {
        address pythSepolia = crossVault.PYTH_CONTRACT_SEPOLIA();
        bytes32 wrongFeedId = bytes32(uint256(0x123456789));
        int64 rawPythPrice = 240000000000;

        TxProof memory proof = _createPythPriceProof(pythSepolia, wrongFeedId, rawPythPrice, 102);

        vm.expectRevert(CrossVault.WrongFeedId.selector);
        crossVault.updatePriceFromPyth(proof);
    }

    /**
     * @notice Rejection test: Revert if Pyth proof is replayed.
     */
    function test_RevertWhen_PythProofReplayed() public {
        address pythSepolia = crossVault.PYTH_CONTRACT_SEPOLIA();
        bytes32 pythFeedId = crossVault.PYTH_ETH_FEED_ID();
        int64 rawPythPrice = 250000000000;

        TxProof memory proof = _createPythPriceProof(pythSepolia, pythFeedId, rawPythPrice, 103);

        crossVault.updatePriceFromPyth(proof);

        vm.expectRevert(CrossVault.ProofAlreadyUsed.selector);
        crossVault.updatePriceFromPyth(proof);
    }

    /**
     * @notice Rejection test: Revert if Pyth price is non-positive.
     */
    function test_RevertWhen_PythProofNonPositivePrice() public {
        address pythSepolia = crossVault.PYTH_CONTRACT_SEPOLIA();
        bytes32 pythFeedId = crossVault.PYTH_ETH_FEED_ID();
        int64 zeroPrice = 0;

        TxProof memory proof = _createPythPriceProof(pythSepolia, pythFeedId, zeroPrice, 104);

        vm.expectRevert(CrossVault.InvalidPrice.selector);
        crossVault.updatePriceFromPyth(proof);
    }
}

