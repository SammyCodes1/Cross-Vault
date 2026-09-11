import React, { useState } from 'react';
import { ethers, Contract } from 'ethers';
import {
  NETWORKS,
  CONTRACT_ADDRESSES,
  CROSS_VAULT_ABI,
  DEBT_TOKEN_ABI,
  LEGACY_DEBT_TOKEN,
  COLLATERAL_LOCK_ABI,
} from '../contracts/config';
import { waitForSepoliaWallet, sendSepoliaTx, mapSepoliaRpcError } from '../lib/sepolia';

export interface VaultPosition {
  positionId: number;
  owner: string;
  collateralAmount: string;
  debtAmount: string;
  collateralRatio: number | null;
  liquidated: boolean;
  repaid: boolean;
  isLiquidatable: boolean;
  vault: string;
  legacy?: boolean;
  lockId?: number;
  sepoliaTx?: string;
  cc3Tx?: string;
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
  onSwitchToSepolia: () => Promise<void>;
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
  onSwitchToSepolia,
  getSigner,
}) => {
  const [liquidatingId, setLiquidatingId] = useState<number | null>(null);
  const [repayingId, setRepayingId] = useState<number | null>(null);
  const [unlockingId, setUnlockingId] = useState<number | null>(null);
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

      const vaultAddr = position.vault || CONTRACT_ADDRESSES.CROSS_VAULT;
      const debtAddr = position.legacy ? LEGACY_DEBT_TOKEN : CONTRACT_ADDRESSES.DEBT_TOKEN;
      const debtTokenContract = new Contract(debtAddr, DEBT_TOKEN_ABI, signer);
      const crossVaultContract = new Contract(vaultAddr, CROSS_VAULT_ABI, signer);

      const debtWei = ethers.parseEther(position.debtAmount);

      const balance: bigint = await debtTokenContract.balanceOf(account);
      if (balance < debtWei) {
        throw new Error(
          `Insufficient tvUSD balance to liquidate. Required: ${position.debtAmount} tvUSD, Current Balance: ${ethers.formatEther(balance)} tvUSD`
        );
      }

      const allowance: bigint = await debtTokenContract.allowance(account, vaultAddr);

      if (allowance < debtWei) {
        setActionMessage('Approving the exact tvUSD needed for liquidation...');
        const approveTx = await debtTokenContract.approve(vaultAddr, debtWei);
        await approveTx.wait();
      }

      setActionMessage(`Calling CrossVault.liquidate(${position.positionId})...`);
      const liqTx = await crossVaultContract.liquidate(position.positionId);
      setActionMessage(`Liquidation tx submitted: ${liqTx.hash.slice(0, 12)}...`);
      await liqTx.wait();

      setActionMessage(`Position #${position.positionId} liquidated successfully!`);
      onRefresh();
      setTimeout(onRefresh, 2500);
      setTimeout(onRefresh, 8000);
    } catch (err: unknown) {
      console.error('Liquidation failed:', err);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setLiquidatingId(null);
    }
  };

  const handleRepay = async (position: VaultPosition) => {
    if (!account) return;
    setErrorMessage(null);
    setActionMessage(null);
    setRepayingId(position.positionId);

    try {
      if (!isCC3) {
        setActionMessage('Switching to Creditcoin 3 to repay...');
        await onSwitchToCC3();
      }

      const signer = await getSigner();
      if (!signer) throw new Error('Could not obtain wallet signer');

      if (position.legacy) {
        throw new Error('Repay is only on the current vault. This position is on the previous vault.');
      }

      const vaultAddr = position.vault || CONTRACT_ADDRESSES.CROSS_VAULT;
      const debtTokenContract = new Contract(
        CONTRACT_ADDRESSES.DEBT_TOKEN,
        DEBT_TOKEN_ABI,
        signer
      );
      const crossVaultContract = new Contract(vaultAddr, CROSS_VAULT_ABI, signer);

      const debtWei = ethers.parseEther(position.debtAmount);
      const balance: bigint = await debtTokenContract.balanceOf(account);
      if (balance < debtWei) {
        throw new Error(
          `Insufficient tvUSD to repay. Required: ${position.debtAmount} tvUSD, balance: ${ethers.formatEther(balance)} tvUSD`
        );
      }

      const allowance: bigint = await debtTokenContract.allowance(account, vaultAddr);
      if (allowance < debtWei) {
        setActionMessage('Approving the exact tvUSD needed to repay...');
        const approveTx = await debtTokenContract.approve(vaultAddr, debtWei);
        await approveTx.wait();
      }

      setActionMessage(`Calling CrossVault.repay(${position.positionId})...`);
      const repayTx = await crossVaultContract.repay(position.positionId);
      await repayTx.wait();
      setActionMessage(`Position #${position.positionId} repaid. Unlock on Sepolia to reclaim mWETH.`);
      onRefresh();
      setTimeout(onRefresh, 2500);
      setTimeout(onRefresh, 8000);
    } catch (err: unknown) {
      console.error('Repay failed:', err);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRepayingId(null);
    }
  };

  const handleUnlock = async (position: VaultPosition) => {
    if (!account || !position.lockId) return;
    setErrorMessage(null);
    setActionMessage(null);
    setUnlockingId(position.positionId);
    try {
      setActionMessage('Switching to Sepolia to unlock escrow...');
      await waitForSepoliaWallet(onSwitchToSepolia);
      const signer = await getSigner();
      if (!signer) throw new Error('Could not obtain wallet signer');
      const iface = new ethers.Interface(COLLATERAL_LOCK_ABI);
      setActionMessage(`Unlocking lock #${position.lockId} on Sepolia...`);
      const sent = await sendSepoliaTx(signer, {
        to: CONTRACT_ADDRESSES.COLLATERAL_LOCK,
        data: iface.encodeFunctionData('unlock', [BigInt(position.lockId)]),
      });
      setActionMessage(`Unlocked. Sepolia tx ${sent.hash.slice(0, 10)}...`);
      onRefresh();
    } catch (err: unknown) {
      console.error('Unlock failed:', err);
      setErrorMessage(mapSepoliaRpcError(err).message);
    } finally {
      setUnlockingId(null);
    }
  };

  const userPositions = account
    ? positions.filter((p) => p.owner.toLowerCase() === account.toLowerCase())
    : [];

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2>Ledger</h2>
          <span className="subtitle">Live CrossVault state on Creditcoin 3</span>
        </div>
        <div className="dashboard-header-right">
          <div className="price-tag-group">
            <div className="price-tag">
              <span className="price-label">Vault Collateral Price:</span>
              <span className="price-value">${currentPrice} tvUSD</span>
            </div>
            <div className={`price-source-badge price-source-${priceSource.toLowerCase()}`}>
              Price source: {priceSource === 'Pyth' ? 'Pyth' : priceSource === 'Manual' ? 'Not Pyth' : 'None'}
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
            <p>No positions on Creditcoin yet.</p>
            <p className="text-muted">Lock mWETH on Sepolia to open the first vault entry.</p>
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
                  <th>Health</th>
                  <th>Status</th>
                  <th>Txs</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos) => {
                  const isUser =
                    account && pos.owner.toLowerCase() === account.toLowerCase();
                  const ratio = pos.collateralRatio;
                  const canBeLiquidated =
                    pos.isLiquidatable || (ratio !== null && ratio < 120 && !pos.repaid && !pos.liquidated);
                  const belowMin = ratio !== null && ratio < 150 && !canBeLiquidated && !pos.repaid && !pos.liquidated;

                  return (
                    <tr key={`${pos.vault}-${pos.positionId}`} className={isUser ? 'user-row' : ''}>
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
                        {pos.liquidated || pos.repaid ? (
                          <span className="text-muted">-</span>
                        ) : ratio !== null ? (
                          <span
                            className={`ratio-pill ${
                              canBeLiquidated
                                ? 'ratio-danger'
                                : belowMin
                                ? 'ratio-warning'
                                : 'ratio-healthy'
                            }`}
                          >
                            {ratio.toFixed(0)}% / 150%
                          </span>
                        ) : (
                          <span>N/A</span>
                        )}
                      </td>
                      <td>
                        {pos.repaid ? (
                          <span className="badge badge-info">Repaid</span>
                        ) : pos.liquidated ? (
                          <span className="badge badge-danger">Liquidated</span>
                        ) : canBeLiquidated ? (
                          <span className="badge badge-danger">Can be liquidated</span>
                        ) : belowMin ? (
                          <span className="badge badge-warning">Below 150%</span>
                        ) : (
                          <span className="badge badge-success">Healthy</span>
                        )}
                      </td>
                      <td>
                        <div className="row-actions">
                          {pos.sepoliaTx ? (
                            <a
                              href={`${NETWORKS.SEPOLIA.blockExplorerUrls[0]}/tx/${pos.sepoliaTx}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Lock
                            </a>
                          ) : null}
                          {pos.cc3Tx ? (
                            <a
                              href={`${NETWORKS.CREDITCOIN.blockExplorerUrls[0]}/tx/${pos.cc3Tx}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Open
                            </a>
                          ) : (
                            !pos.sepoliaTx && <span className="text-muted">-</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="row-actions">
                          {pos.isLiquidatable && !pos.liquidated && !pos.repaid && (
                            <button
                              type="button"
                              className="btn-danger-sm"
                              disabled={liquidatingId === pos.positionId}
                              onClick={() => handleLiquidate(pos)}
                            >
                              {liquidatingId === pos.positionId ? 'Liquidating...' : 'Liquidate'}
                            </button>
                          )}
                          {isUser && !pos.legacy && !pos.liquidated && !pos.repaid && (
                            <button
                              type="button"
                              className="btn-ghost"
                              disabled={repayingId === pos.positionId}
                              onClick={() => handleRepay(pos)}
                            >
                              {repayingId === pos.positionId ? 'Repaying...' : 'Repay'}
                            </button>
                          )}
                          {isUser && pos.repaid && pos.lockId ? (
                            <button
                              type="button"
                              className="btn-ghost"
                              disabled={unlockingId === pos.positionId}
                              onClick={() => handleUnlock(pos)}
                            >
                              {unlockingId === pos.positionId ? 'Unlocking...' : 'Unlock'}
                            </button>
                          ) : null}
                          {(pos.liquidated || (pos.repaid && !pos.lockId)) && (
                            <span className="text-muted">Closed</span>
                          )}
                          {!pos.isLiquidatable && !pos.liquidated && !pos.repaid && !isUser && (
                            <span className="text-muted">Safe</span>
                          )}
                        </div>
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
                    .reduce((acc, p) => acc + (p.liquidated || p.repaid ? 0 : parseFloat(p.collateralAmount)), 0)
                    .toFixed(4)}{' '}
                  mWETH
                </span>
              </div>
              <div className="summary-stat">
                <span className="stat-label">Total Outstanding Debt</span>
                <span className="stat-val text-highlight">
                  {userPositions
                    .reduce((acc, p) => acc + (p.liquidated || p.repaid ? 0 : parseFloat(p.debtAmount)), 0)
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
