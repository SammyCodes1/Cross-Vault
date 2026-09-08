// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {MockCollateralToken} from "../src/MockCollateralToken.sol";
import {CollateralLock} from "../src/CollateralLock.sol";
import {MockPriceFeed} from "../src/MockPriceFeed.sol";

contract DeployScript is Script {
    function run() external returns (
        MockCollateralToken token,
        CollateralLock lock,
        MockPriceFeed feed
    ) {
        // Read SEPOLIA_PRIVATE_KEY from env, or fallback to standard local test key if unset
        uint256 deployerPrivateKey = vm.envOr(
            "SEPOLIA_PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy MockCollateralToken (mWETH)
        token = new MockCollateralToken();

        // 2. Deploy CollateralLock linked to MockCollateralToken
        lock = new CollateralLock(address(token));

        // 3. Deploy MockPriceFeed (owner is deployer)
        feed = new MockPriceFeed();

        vm.stopBroadcast();

        console.log("MockCollateralToken deployed to:", address(token));
        console.log("CollateralLock deployed to:", address(lock));
        console.log("MockPriceFeed deployed to:", address(feed));

        // Format deployment metadata JSON
        string memory jsonObj = "deployment";
        vm.serializeAddress(jsonObj, "mockCollateralToken", address(token));
        vm.serializeAddress(jsonObj, "collateralLock", address(lock));
        vm.serializeAddress(jsonObj, "mockPriceFeed", address(feed));
        vm.serializeAddress(jsonObj, "MockCollateralToken", address(token));
        vm.serializeAddress(jsonObj, "CollateralLock", address(lock));
        string memory finalJson = vm.serializeAddress(jsonObj, "MockPriceFeed", address(feed));

        // Write to deployed-sepolia.json at the repo root
        vm.writeJson(finalJson, "../deployed-sepolia.json");
        console.log("Deployment addresses written to ../deployed-sepolia.json");
    }
}
