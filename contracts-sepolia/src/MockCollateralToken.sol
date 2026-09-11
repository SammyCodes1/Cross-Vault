// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockCollateralToken
 * @notice ERC20 mock token representing Wrapped ETH (mWETH) with 18 decimals and an open mint function.
 */
contract MockCollateralToken is ERC20 {
    uint256 public constant FAUCET_MAX = 10 ether;

    mapping(address => uint256) public minted;

    error FaucetCapExceeded();

    constructor() ERC20("Mock Wrapped ETH", "mWETH") {}

    /**
     * @notice Testnet faucet. Caps lifetime mints per address at FAUCET_MAX.
     */
    function mint(address to, uint256 amount) external {
        uint256 next = minted[to] + amount;
        if (next > FAUCET_MAX) revert FaucetCapExceeded();
        minted[to] = next;
        _mint(to, amount);
    }
}
