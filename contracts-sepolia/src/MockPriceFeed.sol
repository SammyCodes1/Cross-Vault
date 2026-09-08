// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockPriceFeed
 * @notice Mock price oracle whose owner is set at deploy (immutable).
 */
contract MockPriceFeed {
    address public immutable owner;
    uint256 private _price;

    event PriceUpdated(uint256 price, uint256 timestamp);

    error Unauthorized();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Sets a new price. Can only be called by the contract owner.
     * @param newPrice The updated price value.
     */
    function setPrice(uint256 newPrice) external onlyOwner {
        _price = newPrice;
        emit PriceUpdated(newPrice, block.timestamp);
    }

    /**
     * @notice Returns the latest price recorded.
     * @return The latest price.
     */
    function getPrice() external view returns (uint256) {
        return _price;
    }
}
