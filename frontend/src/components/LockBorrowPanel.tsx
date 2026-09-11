import React, { useState } from 'react';
import { ethers, Contract } from 'ethers';
import {
  NETWORKS,
  CONTRACT_ADDRESSES,
  MOCK_COLLATERAL_TOKEN_ABI,
  COLLATERAL_LOCK_ABI,
  RELAYER_BASE_URL,
} from '../contracts/config';

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

  const isSepolia = chainId === NETWORKS.SEPOLIA.chainId;

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

      setCurrentStep('minting');
      setStatusMessage('Minting 1.0 mWETH for testnet...');

      const tokenContract = new Contract(
        CONTRACT_ADDRESSES.MOCK_COLLATERAL_TOKEN,
        MOCK_COLLATERAL_TOKEN_ABI,
        signer
      );

      const tx = await tokenContract.mint(account, ethers.parseEther('1.0'));
      setStatusMessage('Waiting for mint confirmation on Sepolia...');
      await tx.wait();

      setStatusMessage('1.0 mWETH minted successfully!');
      setCurrentStep('idle');
      onRefresh();
    } catch (err: unknown) {
      console.error('Mint error:', err);
      setCurrentStep('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleLockAndBorrow = async () => {
    if (!account) return;
    setErrorMessage(null);
    setOpenedPositionId(null);
    setCc3TxHash(null);
    setLastLockId(null);

    try {
      // 0. Ensure we are on Sepolia
      if (!isSepolia) {
        setStatusMessage('Switching to Sepolia network...');
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
        setCurrentStep('minting');
        setStatusMessage(`Balance low (${ethers.formatEther(balance)} mWETH). Minting 1.0 mWETH for testnet...`);
        const mintTx = await tokenContract.mint(account, ethers.parseEther('1.0'));
        await mintTx.wait();
        setStatusMessage('Minted 1.0 mWETH. Continuing lock process...');
      }

      // 2. Check and approve CollateralLock contract
      setCurrentStep('approving');
      setStatusMessage(`Checking allowance for CollateralLock...`);
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
      setCurrentStep('locking');
      setStatusMessage(`Locking ${amount} mWETH into escrow on Sepolia...`);
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

      setCurrentStep('attesting');
      setStatusMessage(
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
          await new Promise((resolve) => setTimeout(resolve, 3000));
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

      setCurrentStep('verifying');
      setStatusMessage('Submitting proof to CrossVault on Creditcoin 3...');

      setOpenedPositionId(relayerData.positionId || null);
      setCc3TxHash(relayerData.transactionHash || null);

      setCurrentStep('success');
      setStatusMessage(
        `Position #${relayerData.positionId} opened on Creditcoin! Borrowed ${calculateEstimatedDebt()} tvUSD.`
      );
      onRefresh();
    } catch (err: unknown) {
      console.error('Lock and borrow error:', err);
      setCurrentStep('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const isBusy =
    currentStep === 'minting' ||
    currentStep === 'approving' ||
    currentStep === 'locking' ||
    currentStep === 'attesting' ||
    currentStep === 'verifying';

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

        {/* Stepper / Progress display */}
        {currentStep !== 'idle' && (
          <div className={`status-box status-${currentStep}`}>
            <div className="stepper">
              <div className={`step-item ${currentStep === 'locking' || currentStep === 'attesting' || currentStep === 'verifying' || currentStep === 'success' ? 'done' : currentStep === 'approving' ? 'active' : ''}`}>
                <span className="step-circle">1</span>
                <span className="step-label">Locking (Sepolia)</span>
              </div>
              <div className="step-line" />
              <div className={`step-item ${currentStep === 'verifying' || currentStep === 'success' ? 'done' : currentStep === 'attesting' ? 'active' : ''}`}>
                <span className="step-circle">2</span>
                <span className="step-label">Attesting (Prover)</span>
              </div>
              <div className="step-line" />
              <div className={`step-item ${currentStep === 'success' ? 'done' : currentStep === 'verifying' ? 'active' : ''}`}>
                <span className="step-circle">3</span>
                <span className="step-label">Verifying (Creditcoin)</span>
              </div>
            </div>

            <p className="status-text">{statusMessage}</p>

            {lastLockId && (
              <p className="info-sub">
                Sepolia Lock ID: <strong>#{lastLockId}</strong>
              </p>
            )}

            {openedPositionId && (
              <div className="success-details">
                <p>
                  Creditcoin Position ID: <strong>#{openedPositionId}</strong>
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
          </div>
        )}

        {errorMessage && (
          <div className="error-box">
            <strong>Error:</strong> {errorMessage}
          </div>
        )}

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
