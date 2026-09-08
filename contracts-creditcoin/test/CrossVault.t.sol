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
        vm.expectRevert(DebtToken.VaultAlreadySet.selector);
        debtToken.setVault(alice);
    }
}
