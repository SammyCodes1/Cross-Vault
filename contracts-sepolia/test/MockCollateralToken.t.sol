// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MockCollateralToken} from "../src/MockCollateralToken.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

contract MockCollateralTokenTest is Test {
    MockCollateralToken public token;

    address public alice = address(0x1111);
    address public bob = address(0x2222);

    function setUp() public {
        token = new MockCollateralToken();
    }

    function test_Metadata() public view {
        assertEq(token.name(), "Mock Wrapped ETH");
        assertEq(token.symbol(), "mWETH");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), 0);
    }

    function test_Mint_HappyPath() public {
        uint256 mintAmount = 100 ether;
        token.mint(alice, mintAmount);

        assertEq(token.balanceOf(alice), mintAmount);
        assertEq(token.totalSupply(), mintAmount);
    }

    function test_Transfer_HappyPath() public {
        token.mint(alice, 100 ether);

        vm.prank(alice);
        token.transfer(bob, 40 ether);

        assertEq(token.balanceOf(alice), 60 ether);
        assertEq(token.balanceOf(bob), 40 ether);
    }

    function test_RevertWhen_MintToZeroAddress() public {
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InvalidReceiver.selector, address(0))
        );
        token.mint(address(0), 50 ether);
    }

    function test_RevertWhen_TransferExceedsBalance() public {
        token.mint(alice, 10 ether);

        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, alice, 10 ether, 20 ether)
        );
        token.transfer(bob, 20 ether);
    }
}
