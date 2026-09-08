// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title CollateralLock
 * @notice Escrow contract that locks collateral tokens and issues incrementing lock identifiers.
 */
contract CollateralLock {
    using SafeERC20 for IERC20;

    struct LockInfo {
        address owner;
        uint256 amount;
        bool active;
    }

    IERC20 public immutable collateralToken;
    uint256 public nextLockId = 1;

    mapping(uint256 => LockInfo) public locks;

    event Locked(uint256 indexed lockId, address indexed owner, uint256 amount, uint256 timestamp);

    error InvalidToken();
    error InvalidAmount();

    constructor(address _collateralToken) {
        if (_collateralToken == address(0)) revert InvalidToken();
        collateralToken = IERC20(_collateralToken);
    }

    /**
     * @notice Returns the collateral token address.
     */
    function token() external view returns (IERC20) {
        return collateralToken;
    }

    /**
     * @notice Locks an amount of collateral token into the escrow contract.
     * @dev Requires prior approval of the collateral token to this contract.
     * @param amount The amount of tokens to lock.
     * @return lockId The identifier assigned to the created lock.
     */
    function lock(uint256 amount) external returns (uint256 lockId) {
        if (amount == 0) revert InvalidAmount();

        collateralToken.safeTransferFrom(msg.sender, address(this), amount);

        lockId = nextLockId++;
        locks[lockId] = LockInfo({
            owner: msg.sender,
            amount: amount,
            active: true
        });

        emit Locked(lockId, msg.sender, amount, block.timestamp);
    }

    /**
     * @notice Returns the lock details for a given lock ID.
     * @param lockId The identifier of the lock.
     * @return The LockInfo struct containing owner, amount, and active status.
     */
    function getLock(uint256 lockId) external view returns (LockInfo memory) {
        return locks[lockId];
    }
}
