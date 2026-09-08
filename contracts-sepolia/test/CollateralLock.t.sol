// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MockCollateralToken} from "../src/MockCollateralToken.sol";
import {CollateralLock} from "../src/CollateralLock.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

contract CollateralLockTest is Test {
    MockCollateralToken public token;
    CollateralLock public lockContract;

    address public alice = address(0xAAAA);
    address public bob = address(0xBBBB);

    event Locked(uint256 indexed lockId, address indexed owner, uint256 amount, uint256 timestamp);

    function setUp() public {
        token = new MockCollateralToken();
        lockContract = new CollateralLock(address(token));
    }

    function test_InitialState() public view {
        assertEq(address(lockContract.collateralToken()), address(token));
        assertEq(address(lockContract.token()), address(token));
        assertEq(lockContract.nextLockId(), 1);
    }

    function test_Lock_HappyPath() public {
        uint256 depositAmount = 5 ether;
        token.mint(alice, 10 ether);

        vm.startPrank(alice);
        token.approve(address(lockContract), depositAmount);

        vm.expectEmit(true, true, false, true);
        emit Locked(1, alice, depositAmount, block.timestamp);

        uint256 assignedId = lockContract.lock(depositAmount);
        vm.stopPrank();

        assertEq(assignedId, 1);
        assertEq(lockContract.nextLockId(), 2);
        assertEq(token.balanceOf(alice), 5 ether);
        assertEq(token.balanceOf(address(lockContract)), 5 ether);

        CollateralLock.LockInfo memory info = lockContract.getLock(1);
        assertEq(info.owner, alice);
        assertEq(info.amount, 5 ether);
        assertTrue(info.active);
    }

    function test_SequentialLocks_IncrementId() public {
        token.mint(alice, 10 ether);
        token.mint(bob, 10 ether);

        vm.startPrank(alice);
        token.approve(address(lockContract), 2 ether);
        uint256 id1 = lockContract.lock(2 ether);
        vm.stopPrank();

        vm.startPrank(bob);
        token.approve(address(lockContract), 3 ether);
        uint256 id2 = lockContract.lock(3 ether);
        vm.stopPrank();

        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(lockContract.nextLockId(), 3);

        CollateralLock.LockInfo memory lock1 = lockContract.getLock(1);
        assertEq(lock1.owner, alice);
        assertEq(lock1.amount, 2 ether);
        assertTrue(lock1.active);

        CollateralLock.LockInfo memory lock2 = lockContract.getLock(2);
        assertEq(lock2.owner, bob);
        assertEq(lock2.amount, 3 ether);
        assertTrue(lock2.active);
    }

    function test_RevertWhen_LockWithoutApproval() public {
        token.mint(alice, 10 ether);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector,
                address(lockContract),
                0,
                5 ether
            )
        );
        lockContract.lock(5 ether);
    }

    function test_RevertWhen_LockWithInsufficientBalance() public {
        token.mint(alice, 2 ether);

        vm.startPrank(alice);
        token.approve(address(lockContract), 10 ether);

        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector,
                alice,
                2 ether,
                5 ether
            )
        );
        lockContract.lock(5 ether);
        vm.stopPrank();
    }

    function test_RevertWhen_LockZeroAmount() public {
        token.mint(alice, 10 ether);

        vm.startPrank(alice);
        token.approve(address(lockContract), 1 ether);

        vm.expectRevert(CollateralLock.InvalidAmount.selector);
        lockContract.lock(0);
        vm.stopPrank();
    }

    function test_RevertWhen_ConstructorZeroAddress() public {
        vm.expectRevert(CollateralLock.InvalidToken.selector);
        new CollateralLock(address(0));
    }
}
