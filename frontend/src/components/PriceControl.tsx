import React, { useState, useEffect } from 'react';
import { ethers, Contract } from 'ethers';
import {
  NETWORKS,
  CONTRACT_ADDRESSES,
  MOCK_PRICE_FEED_ABI,
  RELAYER_BASE_URL,
} from '../contracts/config';

interface PriceControlProps {
  account: string | null;
  chainId: number | null;
  currentVaultPrice: string;
  priceSource: string;
  onRefresh: () => void;
  onSwitchToSepolia: () => Promise<void>;
  getSigner: () => Promise<ethers.JsonRpcSigner | null>;
}

export const PriceControl: React.FC<PriceControlProps> = ({
  account,
  chainId,
  currentVaultPrice,
  priceSource,
  onRefresh,
  onSwitchToSepolia,
  getSigner,
}) => {
  const [newPrice, setNewPrice] = useState<string>('2000');
  const [oracleOwner, setOracleOwner] = useState<string | null>(null);
  const [sepoliaPrice, setSepoliaPrice] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isSepolia = chainId === NETWORKS.SEPOLIA.chainId;
  const isOwner =
    account && oracleOwner && account.toLowerCase() === oracleOwner.toLowerCase();

  // Read oracle owner and current Sepolia price directly from Sepolia RPC
  useEffect(() => {
    let active = true;
    const fetchOracleInfo = async () => {
      try {
        const sepoliaProvider = new ethers.JsonRpcProvider(
          NETWORKS.SEPOLIA.rpcUrls[0]
        );
        const feedContract = new Contract(
          CONTRACT_ADDRESSES.MOCK_PRICE_FEED,
          MOCK_PRICE_FEED_ABI,
          sepoliaProvider
        );

        const [ownerAddress, rawPrice]: [string, bigint] = await Promise.all([
          feedContract.owner(),
          feedContract.getPrice(),
        ]);

        if (active) {
          setOracleOwner(ownerAddress);
          setSepoliaPrice(ethers.formatEther(rawPrice));
        }
      } catch (err) {
        console.warn('Could not fetch Sepolia oracle info:', err);
      }
    };

    fetchOracleInfo();
    return () => {
      active = false;
    };
  }, [chainId]);

  const handleSetPriceAndAttest = async (priceToSet?: string) => {
    const targetPrice = priceToSet || newPrice;
    if (!account) return;
    setErrorMessage(null);
    setStatusMessage(null);
    setIsUpdating(true);

    try {
      if (!isSepolia) {
        setStatusMessage('Switching wallet to Sepolia...');
        await onSwitchToSepolia();
      }

      const signer = await getSigner();
      if (!signer) throw new Error('Wallet signer not available');

      const numericPrice = parseFloat(targetPrice);
      if (isNaN(numericPrice) || numericPrice <= 0) {
        throw new Error('Please enter a valid positive price');
      }

      const feedContract = new Contract(
        CONTRACT_ADDRESSES.MOCK_PRICE_FEED,
        MOCK_PRICE_FEED_ABI,
        signer
      );

      // 1. Call MockPriceFeed.setPrice(newPrice) on Sepolia
      setStatusMessage(`Calling MockPriceFeed.setPrice(${numericPrice}) on Sepolia...`);
      const parsedPrice = ethers.parseEther(numericPrice.toString());
      const tx = await feedContract.setPrice(parsedPrice);

      setStatusMessage(`Tx submitted: ${tx.hash.slice(0, 10)}... Waiting for Sepolia confirmation...`);
      await tx.wait();

      setStatusMessage(`Sepolia confirmed! Triggering Relayer attestation to Creditcoin 3...`);

      // 2. Call Relayer POST /attest/price
      const relayerRes = await fetch(`${RELAYER_BASE_URL}/attest/price`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!relayerRes.ok) {
        const errJson = await relayerRes.json().catch(() => null);
        throw new Error(errJson?.error || `Relayer returned HTTP status ${relayerRes.status}`);
      }

      const relayerData = await relayerRes.json();
      setStatusMessage(
        `Price updated on Creditcoin! Tx: ${relayerData.transactionHash ? relayerData.transactionHash.slice(0, 12) + '...' : 'confirmed'}`
      );
      setSepoliaPrice(targetPrice);
      onRefresh();
    } catch (err: unknown) {
      console.error('Price update error:', err);
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUpdating(false);
    }
  };

  const handleAttestPythPrice = async () => {
    setErrorMessage(null);
    setStatusMessage('Querying latest Pyth ETH/USD update on Sepolia & requesting attest proof...');
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
        `Pyth live price successfully attested on Creditcoin 3! Tx: ${relayerData.transactionHash ? relayerData.transactionHash.slice(0, 12) + '...' : 'confirmed'}`
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
          <h2>Oracle Price Feeds</h2>
          <span className="subtitle">Live Pyth oracle &amp; manual demo-control</span>
        </div>
        {isOwner ? (
          <span className="badge badge-success">✓ Oracle Owner</span>
        ) : (
          <span className="badge badge-warning">Demo Mode</span>
        )}
      </div>

      <div className="card-body">
        <div className="oracle-meta-grid">
          <div className="oracle-meta-item">
            <span className="text-muted">Active Price Source:</span>
            <span className={`price-source-badge price-source-${priceSource.toLowerCase()}`}>
              {priceSource === 'Pyth' ? 'Pyth (live)' : priceSource === 'Manual' ? 'Manual (demo)' : 'None'}
            </span>
          </div>
          <div className="oracle-meta-item">
            <span className="text-muted">Creditcoin Vault Price:</span>
            <strong className="text-highlight">${currentVaultPrice} tvUSD</strong>
          </div>
          <div className="oracle-meta-item">
            <span className="text-muted">Sepolia Manual Feed:</span>
            <strong>${sepoliaPrice || '...'} tvUSD</strong>
          </div>
          <div className="oracle-meta-item">
            <span className="text-muted">Manual Feed Owner:</span>
            <span className="mono">
              {oracleOwner ? `${oracleOwner.slice(0, 6)}...${oracleOwner.slice(-4)}` : 'Loading...'}
            </span>
          </div>
        </div>

        {/* Pyth Oracle Section */}
        <div style={{ marginBottom: '1.25rem', padding: '0.85rem', background: 'var(--bg-main)', borderRadius: '8px', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <strong style={{ fontSize: '0.9rem', color: '#c084fc' }}>🔮 Pyth Network (Live Oracle)</strong>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Attest verified ETH/USD on-chain price feed from Pyth contract on Sepolia
              </div>
            </div>
            <button
              type="button"
              className="btn-sm"
              style={{ background: '#7c3aed', color: '#fff', border: 'none', padding: '0.4rem 0.85rem', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
              disabled={isUpdating}
              onClick={handleAttestPythPrice}
            >
              {isUpdating ? 'Attesting...' : 'Attest Pyth Live Price'}
            </button>
          </div>
        </div>

        {/* Manual Mock Feed Section */}
        <div style={{ marginBottom: '0.5rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
            ⚙️ Manual MockPriceFeed (Demo-Control Feature)
          </div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
            Manually shift oracle price to demonstrate collateral ratio drops and trigger liquidations
          </div>
        </div>

        {!isOwner && account && (
          <div className="warning-box">
            <span>
              Your connected wallet ({account.slice(0, 6)}...{account.slice(-4)}) is not the MockPriceFeed owner (
              {oracleOwner ? `${oracleOwner.slice(0, 6)}...${oracleOwner.slice(-4)}` : '...'}).
              You can view the controls, but transaction will revert unless signed by the deployer.
            </span>
          </div>
        )}

        <div className="form-group">
          <label htmlFor="target-price">New Price ($/mWETH)</label>
          <div className="input-group">
            <input
              id="target-price"
              type="number"
              min="1"
              step="50"
              disabled={isUpdating}
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              placeholder="2000"
            />
            <button
              type="button"
              className="btn-primary"
              disabled={isUpdating || !account}
              onClick={() => handleSetPriceAndAttest()}
            >
              {isUpdating ? 'Updating...' : 'Set Price & Attest'}
            </button>
          </div>
        </div>

        {/* Demo Quick Presets */}
        <div className="presets-container">
          <span className="preset-label">Quick Presets:</span>
          <button
            type="button"
            className="btn-chip"
            disabled={isUpdating}
            onClick={() => {
              setNewPrice('3000');
              handleSetPriceAndAttest('3000');
            }}
          >
            $3,000 (Baseline)
          </button>
          <button
            type="button"
            className="btn-chip"
            disabled={isUpdating}
            onClick={() => {
              setNewPrice('2000');
              handleSetPriceAndAttest('2000');
            }}
          >
            $2,000 (Drop)
          </button>
          <button
            type="button"
            className="btn-chip btn-chip-danger"
            disabled={isUpdating}
            onClick={() => {
              setNewPrice('1600');
              handleSetPriceAndAttest('1600');
            }}
          >
            $1,600 (Trigger Liquidation)
          </button>
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
