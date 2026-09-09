import React, { useState } from 'react';
import { ethers, Contract } from 'ethers';
import {
  NETWORKS,
  CONTRACT_ADDRESSES,
  CROSS_VAULT_ABI,
  DEBT_TOKEN_ABI,
} from '../contracts/config';

export interface VaultPosition {
  positionId: number;
  owner: string;
  collateralAmount: string; // formatted in mWETH
  debtAmount: string; // formatted in tvUSD
  collateralRatio: number | null; // e.g. 150.0 (%)
  liquidated: boolean;
  isLiquidatable: boolean;
}

interface PositionDashboardProps {
  positions: VaultPosition[];
  currentPrice: string;
  priceSource: string;
  account: string | null;
  chainId: number | null;
  isLoading: boolean;
  onRefresh: () => void;
  onSwitchToCC3: () => Promise<void>;
  getSigner: () => Promise<ethers.JsonRpcSigner | null>;
}

export const PositionDashboard: React.FC<PositionDashboardProps> = ({
  positions,
  currentPrice,
  priceSource,
  account,
  chainId,
  isLoading,
  onRefresh,
  onSwitchToCC3,
  getSigner,
}) => {
  const [liquidatingId, setLiquidatingId] = useState<number | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isCC3 = chainId === NETWORKS.CREDITCOIN.chainId;

  const handleLiquidate = async (position: VaultPosition) => {
    if (!account) return;
    setErrorMessage(null);
    setActionMessage(null);
    setLiquidatingId(position.positionId);

    try {
      if (!isCC3) {
        setActionMessage('Switching to Creditcoin 3 testnet for liquidation...');
        await onSwitchToCC3();
      }

      const signer = await getSigner();
      if (!signer) throw new Error('Could not obtain wallet signer');

      const debtTokenContract = new Contract(
        CONTRACT_ADDRESSES.DEBT_TOKEN,
        DEBT_TOKEN_ABI,
        signer
      );

      const crossVaultContract = new Contract(
        CONTRACT_ADDRESSES.CROSS_VAULT,
        CROSS_VAULT_ABI,
        signer
      );

      const debtWei = ethers.parseEther(position.debtAmount);

      // Check balance
      const balance: bigint = await debtTokenContract.balanceOf(account);
      if (balance < debtWei) {
        throw new Error(
          `Insufficient tvUSD balance to liquidate. Required: ${position.debtAmount} tvUSD, Current Balance: ${ethers.formatEther(balance)} tvUSD`
        );
      }

      // Check allowance
      const allowance: bigint = await debtTokenContract.allowance(
        account,
        CONTRACT_ADDRESSES.CROSS_VAULT
      );

      if (allowance < debtWei) {
        setActionMessage('Approving tvUSD to CrossVault for liquidation burn...');
        const approveTx = await debtTokenContract.approve(
          CONTRACT_ADDRESSES.CROSS_VAULT,
          ethers.MaxUint256
        );
        await approveTx.wait();
      }

      setActionMessage(`Calling CrossVault.liquidate(${position.positionId})...`);
      const liqTx = await crossVaultContract.liquidate(position.positionId);
      setActionMessage(`Liquidation tx submitted: ${liqTx.hash.slice(0, 12)}...`);
      await liqTx.wait();

      setActionMessage(`Position #${position.positionId} liquidated successfully!`);
      onRefresh();
    } catch (err: unknown) {
      console.error('Liquidation failed:', err);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLiquidatingId(null);
    }
  };

  const userPositions = account
    ? positions.filter((p) => p.owner.toLowerCase() === account.toLowerCase())
    : [];

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2>Position Dashboard</h2>
          <span className="subtitle">Real-time state from CrossVault on Creditcoin 3</span>
        </div>
        <div className="dashboard-header-right">
          <div className="price-tag-group">
            <div className="price-tag">
              <span className="price-label">Vault Collateral Price:</span>
              <span className="price-value">${currentPrice} tvUSD</span>
            </div>
            <div className={`price-source-badge price-source-${priceSource.toLowerCase()}`}>
              Price source: {priceSource === 'Pyth' ? 'Pyth (live)' : priceSource === 'Manual' ? 'Manual (demo)' : 'None'}
            </div>
          </div>
          <button
            type="button"
            className="btn-sm"
            onClick={onRefresh}
            disabled={isLoading}
            title="Refresh positions"
          >
            {isLoading ? 'Refreshing...' : '↻ Refresh'}
          </button>
        </div>
      </div>

      <div className="card-body">
        {actionMessage && <div className="info-box">{actionMessage}</div>}
        {errorMessage && <div className="error-box"><strong>Error:</strong> {errorMessage}</div>}

        {positions.length === 0 ? (
          <div className="empty-state">
            <p>No open positions found on Creditcoin 3 CrossVault.</p>
            <p className="text-muted">Use the "Lock & Borrow" panel to create your first cross-chain position.</p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="positions-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Owner</th>
                  <th>Collateral</th>
                  <th>Debt (tvUSD)</th>
                  <th>Collateral Ratio</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => {
                  const isUser =
                    account && pos.owner.toLowerCase() === account.toLowerCase();
                  const isUndercollateralized =
                    pos.collateralRatio !== null && pos.collateralRatio < 120;

                  return (
                    <tr key={pos.positionId} className={isUser ? 'user-row' : ''}>
                      <td>
                        <strong>#{pos.positionId}</strong>
                      </td>
                      <td>
                        <span className="mono">
                          {pos.owner.slice(0, 6)}...{pos.owner.slice(-4)}
                          {isUser && <span className="tag-you">You</span>}
                        </span>
                      </td>
                      <td>
                        <strong>{pos.collateralAmount} mWETH</strong>
                      </td>
                      <td>
                        <strong>{pos.debtAmount} tvUSD</strong>
                      </td>
                      <td>
                        {pos.liquidated ? (
                          <span className="text-muted">—</span>
                        ) : pos.collateralRatio !== null ? (
                          <span
                            className={`ratio-pill ${
                              isUndercollateralized
                                ? 'ratio-danger'
                                : pos.collateralRatio < 150
                                ? 'ratio-warning'
                                : 'ratio-healthy'
                            }`}
                          >
                            {pos.collateralRatio.toFixed(1)}%
                          </span>
                        ) : (
                          <span>N/A</span>
                        )}
                      </td>
                      <td>
                        {pos.liquidated ? (
                          <span className="badge badge-danger">Liquidated</span>
                        ) : isUndercollateralized ? (
                          <span className="badge badge-danger">At Risk (&lt; 120%)</span>
                        ) : (
                          <span className="badge badge-success">Healthy</span>
                        )}
                      </td>
                      <td>
                        {/* Prompt: Liquidate button only appears if isLiquidatable(positionId) is true */}
                        {pos.isLiquidatable && !pos.liquidated && (
                          <button
                            type="button"
                            className="btn-danger-sm"
                            disabled={liquidatingId === pos.positionId}
                            onClick={() => handleLiquidate(pos)}
                          >
                            {liquidatingId === pos.positionId ? 'Liquidating...' : 'Liquidate'}
                          </button>
                        )}
                        {pos.liquidated && <span className="text-muted">Closed</span>}
                        {!pos.isLiquidatable && !pos.liquidated && (
                          <span className="text-muted">Safe</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {account && userPositions.length > 0 && (
          <div className="user-summary">
            <h4>Your Active CrossVault Summary</h4>
            <div className="summary-grid">
              <div className="summary-stat">
                <span className="stat-label">Your Total Positions</span>
                <span className="stat-val">{userPositions.length}</span>
              </div>
              <div className="summary-stat">
                <span className="stat-label">Total Locked Collateral</span>
                <span className="stat-val">
                  {userPositions
                    .reduce((acc, p) => acc + (p.liquidated ? 0 : parseFloat(p.collateralAmount)), 0)
                    .toFixed(4)}{' '}
                  mWETH
                </span>
              </div>
              <div className="summary-stat">
                <span className="stat-label">Total Outstanding Debt</span>
                <span className="stat-val text-highlight">
                  {userPositions
                    .reduce((acc, p) => acc + (p.liquidated ? 0 : parseFloat(p.debtAmount)), 0)
                    .toFixed(2)}{' '}
                  tvUSD
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
