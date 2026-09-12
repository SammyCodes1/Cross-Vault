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
import {
  waitForSepoliaWallet,
  sendSepoliaTx,
  mapSepoliaRpcError,
  getSepoliaProvider,
} from '../lib/sepolia';
import { loadPositionMeta, savePositionMeta } from '../lib/session';
import { ProcessGlass, type ProcessStep } from './ProcessGlass';

const REPAY_STEPS: ProcessStep[] = [
  { id: 'switching', label: 'Creditcoin 3', hint: 'Switch network for repayment' },
  { id: 'approving', label: 'Approve tvUSD', hint: 'Exact debt amount to the vault' },
  { id: 'repay', label: 'Repay debt', hint: 'Burn tvUSD on Creditcoin 3' },
];

const CLAIM_STEPS: ProcessStep[] = [
  { id: 'switching_sepolia', label: 'Switch to Sepolia', hint: 'Connect to Sepolia' },
  { id: 'unlocking', label: 'Claim mWETH', hint: 'Release escrowed tokens to wallet' },
];

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
  claimed?: boolean;
  claimTx?: string;
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

async function findLockId(position: VaultPosition, userAddress: string): Promise<number | null> {
  const meta = loadPositionMeta(position.vault, position.positionId);
  const candidateId =
    position.lockId && position.lockId > 0
      ? position.lockId
      : meta.lockId && meta.lockId > 0
      ? meta.lockId
      : null;

  try {
    const sepolia = await getSepoliaProvider();
    const lockContract = new Contract(
      CONTRACT_ADDRESSES.COLLATERAL_LOCK,
      [
        'function nextLockId() view returns (uint256)',
        'function getLock(uint256) view returns (tuple(address owner, uint256 amount, bool active))',
      ],
      sepolia
    );

    if (candidateId) {
      try {
        const lockInfo = await lockContract.getLock(candidateId);
        if (lockInfo.active && lockInfo.owner.toLowerCase() === userAddress.toLowerCase()) {
          savePositionMeta(position.vault, position.positionId, { lockId: candidateId });
          return candidateId;
        } else if (!lockInfo.active) {
          savePositionMeta(position.vault, position.positionId, { claimed: true });
          return null;
        }
      } catch {
        return candidateId;
      }
    }

    const next = Number(await lockContract.nextLockId());
    const targetWei = ethers.parseEther(position.collateralAmount);
    for (let id = next - 1; id >= 1; id--) {
      const lockInfo = await lockContract.getLock(id);
      if (
        lockInfo.active &&
        lockInfo.owner.toLowerCase() === userAddress.toLowerCase() &&
        lockInfo.amount === targetWei
      ) {
        savePositionMeta(position.vault, position.positionId, { lockId: id });
        return id;
      }
    }
  } catch (e) {
    console.warn('Could not query Sepolia locks:', e);
    if (candidateId) return candidateId;
  }
  return null;
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
  const [repayOpen, setRepayOpen] = useState(false);
  const [repayModalTitle, setRepayModalTitle] = useState('Repay Debt');
  const [repayModalSteps, setRepayModalSteps] = useState<ProcessStep[]>(REPAY_STEPS);
  const [repayStep, setRepayStep] = useState('switching');
  const [repayStatus, setRepayStatus] = useState<'running' | 'success' | 'error'>('running');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [repayActionBtn, setRepayActionBtn] = useState<{
    label: string;
    onClick: () => void;
    disabled?: boolean;
  } | null>(null);
  const [repayTxHash, setRepayTxHash] = useState<string | null>(null);
  const [repayTxUrl, setRepayTxUrl] = useState<string | null>(null);

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

  const executeClaim = async (position: VaultPosition, lockId: number) => {
    setRepayingId(position.positionId);
    setUnlockingId(position.positionId);
    setRepayModalTitle('Claim Collateral');
    setRepayModalSteps(CLAIM_STEPS);
    setRepayOpen(true);
    setRepayStatus('running');
    setRepayStep('switching_sepolia');
    setRepayActionBtn(null);
    setRepayTxHash(null);
    setRepayTxUrl(null);
    setErrorMessage(null);
    setActionMessage('Switching network to Ethereum Sepolia...');

    try {
      await waitForSepoliaWallet(onSwitchToSepolia);
      const signer = await getSigner();
      if (!signer) throw new Error('Could not obtain wallet signer');

      setRepayStep('unlocking');
      setActionMessage(
        `Unlocking Lock #${lockId} on Sepolia to reclaim ${position.collateralAmount} mWETH...`
      );

      const iface = new ethers.Interface(COLLATERAL_LOCK_ABI);
      const sent = await sendSepoliaTx(signer, {
        to: CONTRACT_ADDRESSES.COLLATERAL_LOCK,
        data: iface.encodeFunctionData('unlock', [BigInt(lockId)]),
      });

      savePositionMeta(position.vault, position.positionId, {
        claimed: true,
        lockId,
        claimTx: sent.hash,
      });

      setRepayTxHash(sent.hash);
      setRepayTxUrl(`${NETWORKS.SEPOLIA.blockExplorerUrls[0]}/tx/${sent.hash}`);

      setRepayStatus('success');
      setActionMessage(
        `Claim confirmed! ${position.collateralAmount} mWETH returned to your wallet.`
      );
      setRepayActionBtn(null);
      onRefresh();
      setTimeout(onRefresh, 2500);
      setTimeout(onRefresh, 8000);
    } catch (err: unknown) {
      console.error('Claim failed:', err);
      setRepayStatus('error');
      setErrorMessage(mapSepoliaRpcError(err).message);
    } finally {
      setRepayingId(null);
      setUnlockingId(null);
    }
  };

  const handleRepay = async (position: VaultPosition) => {
    if (!account) return;
    setErrorMessage(null);
    setActionMessage(null);
    setRepayingId(position.positionId);
    setRepayModalTitle('Repay Debt');
    setRepayModalSteps(REPAY_STEPS);
    setRepayActionBtn(null);
    setRepayTxHash(null);
    setRepayTxUrl(null);
    setRepayOpen(true);
    setRepayStatus('running');
    setRepayStep('switching');

    try {
      if (position.legacy) {
        throw new Error('Repay is only on the current vault. This position is on the previous vault.');
      }

      setActionMessage('Switching to Creditcoin 3...');
      if (!isCC3) {
        await onSwitchToCC3();
      }

      const signer = await getSigner();
      if (!signer) throw new Error('Could not obtain wallet signer');

      const vaultAddr = position.vault || CONTRACT_ADDRESSES.CROSS_VAULT;
      const cc3 = new ethers.JsonRpcProvider(NETWORKS.CREDITCOIN.rpcUrls[0]);
      const readDebt = new Contract(CONTRACT_ADDRESSES.DEBT_TOKEN, DEBT_TOKEN_ABI, cc3);
      const debtTokenContract = new Contract(
        CONTRACT_ADDRESSES.DEBT_TOKEN,
        DEBT_TOKEN_ABI,
        signer
      );
      const crossVaultContract = new Contract(vaultAddr, CROSS_VAULT_ABI, signer);

      const debtWei = ethers.parseEther(position.debtAmount);
      const balance: bigint = await readDebt.balanceOf(account);
      if (balance < debtWei) {
        throw new Error(
          `Insufficient tvUSD to repay. Required: ${position.debtAmount} tvUSD, balance: ${ethers.formatEther(balance)} tvUSD`
        );
      }

      setRepayStep('approving');
      const allowance: bigint = await readDebt.allowance(account, vaultAddr);
      if (allowance < debtWei) {
        setActionMessage('Approving the exact tvUSD needed to repay...');
        const approveTx = await debtTokenContract.approve(vaultAddr, debtWei);
        await approveTx.wait();
      }

      setRepayStep('repay');
      setActionMessage(`Calling CrossVault.repay(${position.positionId})...`);
      const repayTx = await crossVaultContract.repay(position.positionId);
      await repayTx.wait();

      onRefresh();
      setTimeout(onRefresh, 2500);

      // Query lock ID for guided collateral reclamation on Sepolia
      setActionMessage('Position repaid on Creditcoin 3! Looking up collateral lock on Sepolia...');
      const lockId = await findLockId(position, account);

      setRepayStatus('success');
      if (lockId) {
        setActionMessage(
          `Position #${position.positionId} repaid on Creditcoin 3! You can now claim your ${position.collateralAmount} mWETH back to your wallet on Sepolia.`
        );
        setRepayActionBtn({
          label: `Claim ${position.collateralAmount} mWETH on Sepolia →`,
          onClick: () => {
            void executeClaim(position, lockId);
          },
        });
      } else {
        setActionMessage(
          `Position #${position.positionId} repaid on Creditcoin 3. Collateral was either already claimed or could not be mapped.`
        );
        setRepayActionBtn(null);
      }
    } catch (err: unknown) {
      console.error('Repay failed:', err);
      setRepayStatus('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setRepayingId(null);
    }
  };

  const handleUnlock = async (position: VaultPosition) => {
    if (!account) return;
    setErrorMessage(null);
    setActionMessage(null);
    setUnlockingId(position.positionId);
    setRepayModalTitle('Claim Collateral');
    setRepayModalSteps(CLAIM_STEPS);
    setRepayActionBtn(null);
    setRepayTxHash(null);
    setRepayTxUrl(null);
    setRepayOpen(true);
    setRepayStatus('running');
    setRepayStep('switching_sepolia');
    setActionMessage('Looking up your collateral lock on Sepolia...');

    try {
      const lockId = await findLockId(position, account);
      if (!lockId) {
        throw new Error(
          'No active collateral lock found on Sepolia for this position. It may have already been claimed.'
        );
      }
      await executeClaim(position, lockId);
    } catch (err: unknown) {
      console.error('Unlock failed:', err);
      setRepayStatus('error');
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
                          ) : null}
                          {pos.claimTx ? (
                            <a
                              href={`${NETWORKS.SEPOLIA.blockExplorerUrls[0]}/tx/${pos.claimTx}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Claim
                            </a>
                          ) : null}
                          {!pos.sepoliaTx && !pos.cc3Tx && !pos.claimTx && (
                            <span className="text-muted">-</span>
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
                          {isUser && !pos.legacy && pos.repaid && !pos.liquidated && !pos.claimed && (
                            <button
                              type="button"
                              className="btn-ghost"
                              disabled={unlockingId === pos.positionId}
                              onClick={() => handleUnlock(pos)}
                              title="Claim your locked mWETH back to your wallet on Sepolia"
                            >
                              {unlockingId === pos.positionId ? 'Claiming...' : 'Claim mWETH'}
                            </button>
                          )}
                          {isUser && !pos.legacy && pos.repaid && pos.claimed && (
                            <span className="badge badge-success">Claimed</span>
                          )}
                          {(pos.liquidated || (pos.legacy && pos.repaid)) && (
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

      <ProcessGlass
        open={repayOpen}
        title={repayModalTitle}
        steps={repayModalSteps}
        currentId={repayStep}
        status={repayStatus}
        message={actionMessage || 'Processing vault action.'}
        error={errorMessage}
        actionButton={repayActionBtn}
        txHash={repayTxHash}
        txUrl={repayTxUrl}
        onDismiss={() => {
          setRepayOpen(false);
          setRepayActionBtn(null);
          setRepayTxHash(null);
          setRepayTxUrl(null);
          if (repayStatus !== 'running') {
            setActionMessage(null);
            setErrorMessage(null);
          }
        }}
      />
    </div>
  );
};
