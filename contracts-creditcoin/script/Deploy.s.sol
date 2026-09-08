// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {DebtToken} from "../src/DebtToken.sol";
import {CrossVault} from "../src/CrossVault.sol";

contract DeployScript is Script {
    function run() external returns (DebtToken debtToken, CrossVault crossVault) {
        // 1. Read private key from env or fallback to local test key
        uint256 deployerPrivateKey = vm.envOr(
            "CC3_PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );

        // 2. Read Sepolia contract addresses (from ../deployed-sepolia.json if exists, else env/defaults)
        address collateralLock = address(0);
        address priceFeed = address(0);

        if (vm.exists("../deployed-sepolia.json")) {
            string memory json = vm.readFile("../deployed-sepolia.json");
            collateralLock = vm.parseJsonAddress(json, ".collateralLock");
            priceFeed = vm.parseJsonAddress(json, ".mockPriceFeed");
        }

        if (collateralLock == address(0)) {
            collateralLock = vm.envOr("SEPOLIA_COLLATERAL_LOCK", address(0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512));
        }
        if (priceFeed == address(0)) {
            priceFeed = vm.envOr("SEPOLIA_PRICE_FEED", address(0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0));
        }

        uint64 sepoliaChainKey = uint64(vm.envOr("SEPOLIA_CHAIN_KEY", uint256(1)));

        console.log("Deploying to Creditcoin 3 Testnet...");
        console.log("Linked Sepolia CollateralLock:", collateralLock);
        console.log("Linked Sepolia PriceFeed:", priceFeed);
        console.log("Sepolia Chain Key:", sepoliaChainKey);

        vm.startBroadcast(deployerPrivateKey);

        // 3. Deploy DebtToken (initial vault unset)
        debtToken = new DebtToken(address(0));

        // 4. Deploy CrossVault
        crossVault = new CrossVault(collateralLock, priceFeed, address(debtToken), sepoliaChainKey);

        // 5. Authorize CrossVault as vault minter/burner for DebtToken
        debtToken.setVault(address(crossVault));

        vm.stopBroadcast();

        console.log("DebtToken deployed to:", address(debtToken));
        console.log("CrossVault deployed to:", address(crossVault));

        // 6. Write deployed addresses to deployed-creditcoin.json at repo root
        string memory jsonObj = "creditcoin_deployment";
        vm.serializeString(jsonObj, "network", "creditcoin3-testnet");
        vm.serializeUint(jsonObj, "chainId", 102031);
        vm.serializeAddress(jsonObj, "debtToken", address(debtToken));
        string memory finalJson = vm.serializeAddress(jsonObj, "crossVault", address(crossVault));

        vm.writeJson(finalJson, "../deployed-creditcoin.json");
        console.log("Deployment addresses written to ../deployed-creditcoin.json");
    }
}
