import React, { useState, useEffect } from 'react';
import { Contract, JsonRpcProvider } from 'ethers';
import {
  NETWORKS,
  RELAYER_BASE_URL,
  PYTH_CONTRACT_SEPOLIA,
  PYTH_ETH_FEED_ID,
  IPYTH_ABI,
} from '../contracts/config';

interface PriceControlProps {
  currentVaultPrice: string;
  priceSource: string;
  onRefresh: () => void;
}

function formatPythUsd(price: bigint, expo: number): string {
  const usd = Number(price) * 10 ** expo;
  if (!Number.isFinite(usd) || usd <= 0) return '...';
  return usd.toFixed(2);
}

export const PriceControl: React.FC<PriceControlProps> = ({
  currentVaultPrice,
  priceSource,
  onRefresh,
}) => {
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sepoliaPythUsd, setSepoliaPythUsd] = useState<string | null>(null);

  const isPyth = priceSource === 'Pyth';

  useEffect(() => {
    let active = true;
    const loadPyth = async () => {
      try {
        const sepoliaProvider = new JsonRpcProvider(NETWORKS.SEPOLIA.rpcUrls[0]);
        const pyth = new Contract(PYTH_CONTRACT_SEPOLIA, IPYTH_ABI, sepoliaProvider);
        const data = await pyth.getPriceUnsafe(PYTH_ETH_FEED_ID);
        if (active) {
          setSepoliaPythUsd(formatPythUsd(data.price, Number(data.expo)));
        }
      } catch (err) {
        console.warn('Could not read Sepolia Pyth price:', err);
      }
    };
    loadPyth();
    return () => {
      active = false;
    };
  }, []);

  const handleAttestPythPrice = async () => {
    setErrorMessage(null);
    setStatusMessage('Attesting the latest Pyth ETH/USD update from Sepolia. This can take several minutes while Creditcoin proves the block.');
    setIsUpdating(true);

    try {
      const relayerRes = await fetch(`${RELAYER_BASE_URL}/attest/price/pyth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!relayerRes.ok) {
        const errJson = await relayerRes.json().catch(() => null);
        throw new Error(errJson?.error || `Relayer returned HTTP status ${relayerRes.status}`);
      }

      const relayerData = await relayerRes.json();
      setStatusMessage(
        `Pyth price is live on Creditcoin. Tx: ${
          relayerData.transactionHash ? relayerData.transactionHash.slice(0, 12) + '...' : 'confirmed'
        }`
      );
      onRefresh();
    } catch (err: unknown) {
      console.error('Pyth attestation error:', err);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h2>Oracle</h2>
          <span className="subtitle">Pyth ETH/USD, attested from Sepolia</span>
        </div>
        <span className={`badge ${isPyth ? 'badge-success' : 'badge-warning'}`}>
          {isPyth ? 'Pyth live' : priceSource === 'Manual' ? 'Waiting on Pyth' : 'No price'}
        </span>
      </div>

      <div className="card-body">
        <div className="oracle-meta-grid">
          <div className="oracle-meta-item">
            <span className="text-muted">Vault source</span>
            <span className={`price-source-badge price-source-${priceSource.toLowerCase()}`}>
              {isPyth ? 'Pyth' : priceSource === 'Manual' ? 'Not Pyth yet' : 'None'}
            </span>
          </div>
          <div className="oracle-meta-item">
            <span className="text-muted">Vault price</span>
            <strong className="text-highlight">${currentVaultPrice}</strong>
          </div>
          <div className="oracle-meta-item">
            <span className="text-muted">Sepolia Pyth ETH/USD</span>
            <strong>${sepoliaPythUsd || '...'}</strong>
          </div>
          <div className="oracle-meta-item">
            <span className="text-muted">Feed</span>
            <span className="mono">ETH/USD</span>
          </div>
        </div>

        <div className="oracle-section">
          <div className="oracle-section-header">
            <div>
              <div className="oracle-section-title">Attest Pyth</div>
              <div className="oracle-section-desc">
                Pull the latest ETH/USD PriceFeedUpdate from Sepolia and set it as the vault price.
              </div>
            </div>
            <button
              type="button"
              className="btn-pyth"
              disabled={isUpdating}
              onClick={handleAttestPythPrice}
            >
              {isUpdating ? 'Attesting...' : isPyth ? 'Refresh Pyth' : 'Switch to Pyth'}
            </button>
          </div>
        </div>

        {statusMessage && <div className="info-box">{statusMessage}</div>}
        {errorMessage && (
          <div className="error-box">
            <strong>Error:</strong> {errorMessage}
          </div>
        )}
      </div>
    </div>
  );
};
