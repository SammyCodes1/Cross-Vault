// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockCollateralToken
 * @notice ERC20 mock token representing Wrapped ETH (mWETH) with 18 decimals and an open mint function.
 */
contract MockCollateralToken is ERC20 {
    constructor() ERC20("Mock Wrapped ETH", "mWETH") {}

    /**
     * @notice Mint tokens to a given recipient. Testnet only, no access control.
     * @param to The address to receive minted tokens.
     * @param amount The amount of tokens to mint.
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
