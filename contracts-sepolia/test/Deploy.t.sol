// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DeployScript} from "../script/Deploy.s.sol";
import {MockCollateralToken} from "../src/MockCollateralToken.sol";
import {CollateralLock} from "../src/CollateralLock.sol";
import {MockPriceFeed} from "../src/MockPriceFeed.sol";

contract DeployScriptTest is Test {
    DeployScript public script;

    function setUp() public {
        script = new DeployScript();
    }

    function test_DeployScript_ExecutesAndDeploysAllContracts() public {
        (MockCollateralToken token, CollateralLock lock, MockPriceFeed feed) = script.run();

        assertTrue(address(token) != address(0));
        assertTrue(address(lock) != address(0));
        assertTrue(address(feed) != address(0));

        assertEq(address(lock.collateralToken()), address(token));
        assertEq(token.name(), "Mock Wrapped ETH");
        assertEq(token.symbol(), "mWETH");
        assertEq(feed.getPrice(), 0);

        // Verify deployed-sepolia.json was created
        string memory jsonContent = vm.readFile("../deployed-sepolia.json");
        assertTrue(bytes(jsonContent).length > 0);
    }
}
