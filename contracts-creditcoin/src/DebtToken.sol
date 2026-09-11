// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title DebtToken
 * @notice ERC20 token representing CrossVault Test USD (tvUSD) with 18 decimals.
 * Mintable and burnable exclusively by the authorized CrossVault contract.
 */
contract DebtToken is ERC20 {
    address public vault;
    address public immutable deployer;

    error Unauthorized();
    error VaultAlreadySet();
    error InvalidVault();

    modifier onlyVault() {
        if (msg.sender != vault) revert Unauthorized();
        _;
    }

    /**
     * @notice Sets the vault address at deployment.
     * @param _vault Address of the authorized CrossVault contract.
     */
    constructor(address _vault) ERC20("CrossVault Test USD", "tvUSD") {
        vault = _vault;
        deployer = msg.sender;
    }

    /**
     * @notice Allows the deployer to set the vault address if it was left unset.
     * Can only be called once, and only by the contract deployer.
     * @param _vault Address of the CrossVault contract.
     */
    function setVault(address _vault) external {
        if (msg.sender != deployer) revert Unauthorized();
        if (vault != address(0)) revert VaultAlreadySet();
        if (_vault == address(0)) revert InvalidVault();
        vault = _vault;
    }

    /**
     * @notice Mint debt tokens. Only callable by the vault.
     * @param to Recipient address.
     * @param amount Amount to mint.
     */
    function mint(address to, uint256 amount) external onlyVault {
        _mint(to, amount);
    }

    /**
     * @notice Burn debt tokens from a specified account. Only callable by the vault.
     * @param from Address to burn tokens from.
     * @param amount Amount to burn.
     */
    function burn(address from, uint256 amount) external onlyVault {
        _burn(from, amount);
    }
}
