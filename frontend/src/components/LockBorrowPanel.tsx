import React, { useState } from 'react';
import { ethers, Contract } from 'ethers';
import {
  NETWORKS,
  CONTRACT_ADDRESSES,
  MOCK_COLLATERAL_TOKEN_ABI,
  COLLATERAL_LOCK_ABI,
  RELAYER_BASE_URL,
} from '../contracts/config';
import { ProcessGlass, type ProcessStep } from './ProcessGlass';

const LOCK_STEPS: ProcessStep[] = [
  { id: 'minting', label: 'Mint mWETH', hint: 'Faucet 1.0 if the wallet is short' },
  { id: 'approving', label: 'Approve lock', hint: 'Exact amount to CollateralLock' },
  { id: 'locking', label: 'Lock on Sepolia', hint: 'Escrow collateral and emit a lock id' },
  { id: 'attesting', label: 'Attest proof', hint: 'Wait for Creditcoin to prove the block' },
  { id: 'verifying', label: 'Borrow tvUSD', hint: 'Open the position on Creditcoin 3' },
];

const MINT_STEPS: ProcessStep[] = [
  { id: 'minting', label: 'Mint mWETH', hint: '1.0 testnet tokens to this wallet' },
];

interface LockBorrowPanelProps {
  account: string | null;
  chainId: number | null;
  collateralBalance: string;
  currentPrice: string;
  onRefresh: () => void;
  onSwitchToSepolia: () => Promise<void>;
  getSigner: () => Promise<ethers.JsonRpcSigner | null>;
}

export type StepState =
  | 'idle'
  | 'minting'
  | 'approving'
  | 'locking'
  | 'attesting'
  | 'verifying'
  | 'success'
  | 'error';

export const LockBorrowPanel: React.FC<LockBorrowPanelProps> = ({
  account,
  chainId,
  collateralBalance,
  currentPrice,
  onRefresh,
  onSwitchToSepolia,
  getSigner,
}) => {
  const [amount, setAmount] = useState<string>('0.1');
  const [currentStep, setCurrentStep] = useState<StepState>('idle');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [lastLockId, setLastLockId] = useState<number | null>(null);
  const [openedPositionId, setOpenedPositionId] = useState<number | null>(null);
  const [cc3TxHash, setCc3TxHash] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [flowKind, setFlowKind] = useState<'lock' | 'mint'>('lock');
  const [processId, setProcessId] = useState<StepState>('locking');

  const isSepolia = chainId === NETWORKS.SEPOLIA.chainId;

  const goTo = (step: StepState, message?: string) => {
    setCurrentStep(step);
    if (step !== 'idle' && step !== 'success' && step !== 'error') {
      setProcessId(step);
    }
    if (message) setStatusMessage(message);
  };

  // Calculate estimated debt: (amount * currentPrice * 100) / 150
  const calculateEstimatedDebt = (): string => {
    try {
      const parsedAmount = parseFloat(amount);
      const parsedPrice = parseFloat(currentPrice);
      if (isNaN(parsedAmount) || isNaN(parsedPrice) || parsedAmount <= 0 || parsedPrice <= 0) {
        return '0.00';
      }
      const debt = (parsedAmount * parsedPrice * 100) / 150;
      return debt.toFixed(2);
    } catch {
      return '0.00';
    }
  };

  const handleMintTestnet = async () => {
    if (!account) return;
    setErrorMessage(null);
    try {
      if (!isSepolia) {
        await onSwitchToSepolia();
      }
      const signer = await getSigner();
      if (!signer) throw new Error('No signer available');

      setFlowKind('mint');
      goTo('minting', 'Minting 1.0 mWETH for testnet...');

      const tokenContract = new Contract(
        CONTRACT_ADDRESSES.MOCK_COLLATERAL_TOKEN,
        MOCK_COLLATERAL_TOKEN_ABI,
        signer
      );

      const tx = await tokenContract.mint(account, ethers.parseEther('1.0'));
      setStatusMessage('Waiting for mint confirmation on Sepolia...');
      await tx.wait();

      goTo('success', '1.0 mWETH minted to this wallet.');
      onRefresh();
    } catch (err: unknown) {
      console.error('Mint error:', err);
      goTo('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleLockAndBorrow = async () => {
    if (!account) return;
    setErrorMessage(null);
    setOpenedPositionId(null);
    setCc3TxHash(null);
    setLastLockId(null);
    setFlowKind('lock');
    goTo('approving', 'Preparing lock and borrow...');

    try {
      if (!isSepolia) {
        goTo('approving', 'Switching to Sepolia...');
        await onSwitchToSepolia();
      }

      const signer = await getSigner();
      if (!signer) throw new Error('Could not obtain wallet signer');

      const parsedAmount = ethers.parseEther(amount || '0');
      if (parsedAmount <= 0n) {
        throw new Error('Please enter a valid amount greater than 0');
      }

      const tokenContract = new Contract(
        CONTRACT_ADDRESSES.MOCK_COLLATERAL_TOKEN,
        MOCK_COLLATERAL_TOKEN_ABI,
        signer
      );

      // 1. Check user balance; if 0, mint 1.0 mWETH as testnet convenience
      const balance: bigint = await tokenContract.balanceOf(account);
      if (balance === 0n || balance < parsedAmount) {
        goTo('minting', `Balance low (${ethers.formatEther(balance)} mWETH). Minting 1.0 mWETH...`);
        const mintTx = await tokenContract.mint(account, ethers.parseEther('1.0'));
        await mintTx.wait();
        setStatusMessage('Minted 1.0 mWETH. Continuing lock process...');
      }

      // 2. Check and approve CollateralLock contract
      goTo('approving', 'Checking allowance for CollateralLock...');
      const currentAllowance: bigint = await tokenContract.allowance(
        account,
        CONTRACT_ADDRESSES.COLLATERAL_LOCK
      );

      if (currentAllowance < parsedAmount) {
        setStatusMessage(`Approving ${amount} mWETH for CollateralLock...`);
        const approveTx = await tokenContract.approve(
          CONTRACT_ADDRESSES.COLLATERAL_LOCK,
          parsedAmount
        );
        await approveTx.wait();
        setStatusMessage('Approval confirmed. Preparing lock...');
      }

      // 3. Call CollateralLock.lock(amount)
      goTo('locking', `Locking ${amount} mWETH into escrow on Sepolia...`);
      const lockContract = new Contract(
        CONTRACT_ADDRESSES.COLLATERAL_LOCK,
        COLLATERAL_LOCK_ABI,
        signer
      );

      const lockTx = await lockContract.lock(parsedAmount);
      setStatusMessage(`Transaction submitted: ${lockTx.hash.slice(0, 10)}... Awaiting confirmation...`);
      const receipt = await lockTx.wait();

      // Extract lockId from Locked event
      let lockId: number | null = null;
      for (const log of receipt.logs) {
        try {
          const parsed = lockContract.interface.parseLog(log);
          if (parsed && parsed.name === 'Locked') {
            lockId = Number(parsed.args.lockId);
            break;
          }
        } catch {
          // ignore non-matching logs
        }
      }

      if (lockId === null) {
        throw new Error('Lock transaction succeeded but lockId could not be decoded from receipt');
      }

      setLastLockId(lockId);
      setStatusMessage(`Collateral locked on Sepolia with Lock ID #${lockId}!`);

      goTo(
        'attesting',
        `Waiting for Creditcoin to attest Sepolia block ${receipt.blockNumber}. This can take several minutes.`
      );

      const relayerRes = await fetch(`${RELAYER_BASE_URL}/attest/lock/${lockId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transactionHash: lockTx.hash,
          blockNumber: receipt.blockNumber,
        }),
      });

      const relayerJson = await relayerRes.json().catch(() => null);
      if (!relayerRes.ok && relayerRes.status !== 202) {
        throw new Error(relayerJson?.error || `Relayer returned HTTP status ${relayerRes.status}`);
      }

      let relayerData = relayerJson || {};
      if (relayerRes.status === 202 && relayerJson?.jobId) {
        const deadline = Date.now() + 15 * 60 * 1000;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          const jobRes = await fetch(`${RELAYER_BASE_URL}/attest/jobs/${relayerJson.jobId}`);
          const job = await jobRes.json().catch(() => null);
          if (!jobRes.ok || !job) {
            throw new Error(job?.error || `Relayer job poll failed (${jobRes.status})`);
          }
          if (job.message) setStatusMessage(job.message);
          if (job.status === 'completed') {
            relayerData = job;
            break;
          }
          if (job.status === 'failed') {
            throw new Error(job.error || 'Attestation failed');
          }
        }
        if (!relayerData.transactionHash && !relayerData.positionId) {
          throw new Error('Attestation timed out waiting for the Creditcoin prover');
        }
      }

      goTo('verifying', 'Submitting proof to CrossVault on Creditcoin 3...');

      setOpenedPositionId(relayerData.positionId || null);
      setCc3TxHash(relayerData.transactionHash || null);

      goTo(
        'success',
        `Position #${relayerData.positionId} opened. Borrowed about ${calculateEstimatedDebt()} tvUSD.`
      );
      onRefresh();
      window.setTimeout(onRefresh, 2000);
      window.setTimeout(onRefresh, 6000);
    } catch (err: unknown) {
      console.error('Lock and borrow error:', err);
      goTo('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const isBusy = currentStep !== 'idle';
  const sheetStatus =
    currentStep === 'success' ? 'success' : currentStep === 'error' ? 'error' : 'running';
  const processSteps = flowKind === 'mint' ? MINT_STEPS : LOCK_STEPS;

  const dismissSheet = () => {
    setCurrentStep('idle');
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>Lock</h2>
        <span className="badge badge-info">150% ratio</span>
      </div>

      <div className="card-body">
        <div className="form-group">
          <div className="label-row">
            <label htmlFor="collateral-amount">mWETH on Sepolia</label>
            <span className="balance-text">
              Balance: <strong>{collateralBalance} mWETH</strong>
            </span>
          </div>

          <div className="input-group">
            <input
              id="collateral-amount"
              type="number"
              step="0.01"
              min="0.01"
              disabled={isBusy}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.1"
            />
            <button
              type="button"
              className="btn-outline"
              disabled={isBusy}
              onClick={handleMintTestnet}
              title="Mint 1.0 testnet mWETH"
            >
              + Mint 1 mWETH
            </button>
          </div>
        </div>

        <div className="calculation-box">
          <div className="calc-row">
            <span>Current Collateral Price:</span>
            <strong>${currentPrice} tvUSD / mWETH</strong>
          </div>
          <div className="calc-row">
            <span>Estimated Debt to Receive:</span>
            <strong className="text-highlight">~ {calculateEstimatedDebt()} tvUSD</strong>
          </div>
          <div className="calc-row text-muted">
            <span>Liquidation Threshold:</span>
            <span>120% Collateralization Ratio</span>
          </div>
        </div>

        {openedPositionId && currentStep === 'idle' && (
          <div className="success-details">
            <p>
              Last position: <strong>#{openedPositionId}</strong>
              {lastLockId ? ` from lock #${lastLockId}` : ''}
            </p>
            {cc3TxHash && (
              <p>
                CC3 Tx:{' '}
                <a
                  href={`${NETWORKS.CREDITCOIN.blockExplorerUrls[0]}/tx/${cc3TxHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {cc3TxHash.slice(0, 16)}...
                </a>
              </p>
            )}
          </div>
        )}

        <ProcessGlass
          open={currentStep !== 'idle'}
          title={flowKind === 'mint' ? 'Mint mWETH' : 'Lock and borrow'}
          steps={processSteps}
          currentId={processId}
          status={sheetStatus}
          message={statusMessage}
          error={errorMessage}
          onDismiss={dismissSheet}
        />

        <button
          type="button"
          className="btn-primary btn-block"
          disabled={!account || isBusy}
          onClick={handleLockAndBorrow}
        >
          {isBusy ? 'Working...' : !isSepolia ? 'Switch to Sepolia' : 'Lock and borrow'}
        </button>
      </div>
    </div>
  );
};
