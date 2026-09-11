import React from 'react';
import { NETWORKS } from '../contracts/config';

interface WalletConnectProps {
  account: string | null;
  chainId: number | null;
  isConnecting: boolean;
  onConnect: () => Promise<void>;
  onDisconnect: () => void;
  onSwitchToCC3: () => Promise<void>;
  onSwitchToSepolia: () => Promise<void>;
}

export const WalletConnect: React.FC<WalletConnectProps> = ({
  account,
  chainId,
  isConnecting,
  onConnect,
  onDisconnect,
  onSwitchToCC3,
  onSwitchToSepolia,
}) => {
  const getNetworkBadge = () => {
    if (!chainId) return null;
    if (chainId === NETWORKS.SEPOLIA.chainId) {
      return <span className="badge badge-sepolia">Sepolia ({chainId})</span>;
    }
    if (chainId === NETWORKS.CREDITCOIN.chainId) {
      return <span className="badge badge-cc3">Creditcoin Testnet ({chainId})</span>;
    }
    return <span className="badge badge-warning">Unsupported Chain ({chainId})</span>;
  };

  return (
    <header className="header-container">
      <a className="brand" href="/">
        <svg className="vault-mark" viewBox="0 0 32 32" aria-hidden="true">
          <rect x="7" y="7" width="18" height="18" rx="2" fill="none" stroke="#c8e06a" strokeWidth="1.6" />
          <rect x="12" y="12" width="8" height="8" fill="#c8e06a" />
        </svg>
        <div>
          <h1>CrossVault</h1>
          <span className="subtitle">Sepolia to Creditcoin</span>
        </div>
      </a>

      <div className="wallet-actions">
        {account ? (
          <>
            <div className="network-info">
              {getNetworkBadge()}
              <div className="network-switchers">
                <button
                  type="button"
                  className={`btn-sm ${chainId === NETWORKS.SEPOLIA.chainId ? 'btn-active' : ''}`}
                  onClick={onSwitchToSepolia}
                >
                  Sepolia
                </button>
                <button
                  type="button"
                  className={`btn-sm ${chainId === NETWORKS.CREDITCOIN.chainId ? 'btn-active' : ''}`}
                  onClick={onSwitchToCC3}
                >
                  Creditcoin 3
                </button>
              </div>
            </div>

            <div className="account-pill">
              <span className="account-dot" />
              <span className="account-address">
                {account.slice(0, 6)}...{account.slice(-4)}
              </span>
              <button type="button" className="btn-icon" title="Disconnect" onClick={onDisconnect}>
                ✕
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            className="btn-primary"
            disabled={isConnecting}
            onClick={onConnect}
          >
            {isConnecting ? 'Connecting...' : 'Connect Wallet'}
          </button>
        )}
      </div>
    </header>
  );
};
