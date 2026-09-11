// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockPriceFeed
 * @notice Mock price oracle whose owner is set at deploy (immutable).
 */
contract MockPriceFeed {
    address public immutable owner;
    uint256 private _price;
    uint256 public constant MAX_PRICE = 1_000_000 ether;

    event PriceUpdated(uint256 price, uint256 timestamp);

    error Unauthorized();
    error InvalidPrice();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Sets a new price. Owner only. Rejects 0 and values above MAX_PRICE.
     */
    function setPrice(uint256 newPrice) external onlyOwner {
        if (newPrice == 0 || newPrice > MAX_PRICE) revert InvalidPrice();
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
