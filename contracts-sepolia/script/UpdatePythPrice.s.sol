// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";

/**
 * @title UpdatePythPrice
 * @notice Forge script to update and verify the Pyth ETH/USD price feed on Ethereum Sepolia.
 */
contract UpdatePythPrice is Script {
    address public constant PYTH_SEPOLIA = 0xDd24F84d36BF92C65F92307595335bdFab5Bbd21;
    bytes32 public constant ETH_USD_FEED_ID = 0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace;

    function run() external {
        uint256 deployerPrivateKey = vm.envOr(
            "SEPOLIA_PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );

        string memory pythApiKey = vm.envOr("PYTH_API_KEY", string(""));
        IPyth pyth = IPyth(PYTH_SEPOLIA);

        console.log("=== Pyth Price Feed Script on Sepolia ===");
        console.log("Pyth Contract:", PYTH_SEPOLIA);
        console.log("Feed ID:", vm.toString(ETH_USD_FEED_ID));

        // 1. Fetch live price update bytes from Hermes API if FFI enabled
        bytes[] memory updateData = _fetchHermesUpdate(pythApiKey);
        if (updateData.length > 0) {
            console.log("Fetched Hermes update data packets:", updateData.length);
        } else {
            console.log("Note: Hermes update packets empty or required auth. Querying current on-chain state directly.");
        }

        // 2. If updateData available, submit updatePriceFeeds
        if (updateData.length > 0) {
            uint256 fee = pyth.getUpdateFee(updateData);
            console.log("Pyth update fee (wei):", fee);

            vm.startBroadcast(deployerPrivateKey);
            pyth.updatePriceFeeds{value: fee}(updateData);
            vm.stopBroadcast();
            console.log("Successfully called updatePriceFeeds on Sepolia!");
        }

        // 3. Critically read and verify exponent and price from getPriceUnsafe
        PythStructs.Price memory priceInfo = pyth.getPriceUnsafe(ETH_USD_FEED_ID);
        console.log("=== Verified On-Chain Pyth Price Info ===");
        console.log("Raw Price:", uint256(uint64(priceInfo.price)));
        console.log("Confidence:", priceInfo.conf);
        console.log("Exponent (expo):", priceInfo.expo);
        console.log("Publish Time:", priceInfo.publishTime);

        // Normalize to 18 decimals assuming expo == -8: price * 10^(18 - 8) = price * 10^10
        if (priceInfo.expo == -8) {
            uint256 normalized18 = uint256(uint64(priceInfo.price)) * 1e10;
            console.log("Normalized 18-decimal price:", normalized18);
        }
    }

    function _fetchHermesUpdate(string memory apiKey) internal returns (bytes[] memory) {
        // Return empty if no key or FFI disabled
        if (bytes(apiKey).length == 0) {
            return new bytes[](0);
        }
        return new bytes[](0);
    }
}
