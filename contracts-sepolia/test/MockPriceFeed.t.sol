// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MockPriceFeed} from "../src/MockPriceFeed.sol";

contract MockPriceFeedTest is Test {
    MockPriceFeed public feed;
    address public deployer = address(this);
    address public alice = address(0x9999);

    event PriceUpdated(uint256 price, uint256 timestamp);

    function setUp() public {
        feed = new MockPriceFeed();
    }

    function test_InitialOwnerAndPrice() public view {
        assertEq(feed.owner(), deployer);
        assertEq(feed.getPrice(), 0);
    }

    function test_SetPrice_HappyPath() public {
        uint256 targetPrice = 2500 * 1e8;

        vm.expectEmit(false, false, false, true);
        emit PriceUpdated(targetPrice, block.timestamp);

        feed.setPrice(targetPrice);
        assertEq(feed.getPrice(), targetPrice);

        // Update again
        uint256 secondPrice = 2800 * 1e8;
        feed.setPrice(secondPrice);
        assertEq(feed.getPrice(), secondPrice);
    }

    function test_RevertWhen_NonOwnerCallsSetPrice() public {
        vm.prank(alice);
        vm.expectRevert(MockPriceFeed.Unauthorized.selector);
        feed.setPrice(3000 * 1e8);
    }
}
