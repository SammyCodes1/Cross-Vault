// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {DeployScript} from "../script/Deploy.s.sol";
import {DebtToken} from "../src/DebtToken.sol";
import {CrossVault} from "../src/CrossVault.sol";

contract DeployScriptTest is Test {
    DeployScript public script;

    function setUp() public {
        script = new DeployScript();
    }

    function test_DeployScript_ExecutesAndDeploysAllContracts() public {
        string memory existingJson = "";
        bool existed = vm.exists("../deployed-creditcoin.json");
        if (existed) {
            existingJson = vm.readFile("../deployed-creditcoin.json");
        }

        (DebtToken token, CrossVault vault) = script.run();

        assertTrue(address(token) != address(0));
        assertTrue(address(vault) != address(0));

        assertEq(token.name(), "CrossVault Test USD");
        assertEq(token.symbol(), "tvUSD");
        assertEq(token.decimals(), 18);
        assertEq(token.vault(), address(vault));
        assertEq(address(vault.debtToken()), address(token));
        assertEq(vault.sepoliaChainKey(), 1);

        // Verify deployed-creditcoin.json was created and matches requested schema
        string memory jsonContent = vm.readFile("../deployed-creditcoin.json");
        assertTrue(bytes(jsonContent).length > 0);

        string memory network = vm.parseJsonString(jsonContent, ".network");
        assertEq(network, "creditcoin3-testnet");

        uint256 chainId = vm.parseJsonUint(jsonContent, ".chainId");
        assertEq(chainId, 102031);

        address deployedDebtToken = vm.parseJsonAddress(jsonContent, ".debtToken");
        assertEq(deployedDebtToken, address(token));

        address deployedCrossVault = vm.parseJsonAddress(jsonContent, ".crossVault");
        assertEq(deployedCrossVault, address(vault));

        // Restore real live deployment configuration
        if (existed) {
            vm.writeFile("../deployed-creditcoin.json", existingJson);
        }
    }
}
