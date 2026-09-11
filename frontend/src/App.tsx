import React, { useState, useEffect, useCallback } from 'react';
import { ethers, BrowserProvider, Contract } from 'ethers';
import {
  NETWORKS,
  CONTRACT_ADDRESSES,
  MOCK_COLLATERAL_TOKEN_ABI,
  DEBT_TOKEN_ABI,
  CROSS_VAULT_ABI,
} from './contracts/config';
import { WalletConnect } from './components/WalletConnect';
import { LockBorrowPanel } from './components/LockBorrowPanel';
import { PositionDashboard, type VaultPosition } from './components/PositionDashboard';
import { PriceControl } from './components/PriceControl';
import './App.css';

declare global {
  interface Window {
    ethereum?: any;
  }
}

export const App: React.FC = () => {
  const [account, setAccount] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [collateralBalance, setCollateralBalance] = useState<string>('0.00');
  const [debtBalance, setDebtBalance] = useState<string>('0.00');
  const [currentPrice, setCurrentPrice] = useState<string>('3000.00');
  const [priceSource, setPriceSource] = useState<string>('None');
  const [positions, setPositions] = useState<VaultPosition[]>([]);
  const [isLoadingPositions, setIsLoadingPositions] = useState<boolean>(false);

  // Helper to obtain signer from window.ethereum
  const getSigner = useCallback(async (): Promise<ethers.JsonRpcSigner | null> => {
    if (!window.ethereum) return null;
    const provider = new BrowserProvider(window.ethereum);
    return await provider.getSigner();
  }, []);

  // Switch to Creditcoin 3 Testnet
  const handleSwitchToCC3 = useCallback(async () => {
    if (!window.ethereum) {
      alert('MetaMask or Web3 wallet not detected.');
      return;
    }
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: NETWORKS.CREDITCOIN.chainIdHex }],
      });
    } catch (switchError: any) {
      // Error code 4902 indicates chain not added
      if (switchError.code === 4902 || switchError?.data?.originalError?.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: NETWORKS.CREDITCOIN.chainIdHex,
              chainName: NETWORKS.CREDITCOIN.chainName,
              nativeCurrency: NETWORKS.CREDITCOIN.nativeCurrency,
              rpcUrls: NETWORKS.CREDITCOIN.rpcUrls,
              blockExplorerUrls: NETWORKS.CREDITCOIN.blockExplorerUrls,
            },
          ],
        });
      } else {
        console.error('Failed to switch to CC3:', switchError);
        throw switchError;
      }
    }
  }, []);

  // Switch to Sepolia
  const handleSwitchToSepolia = useCallback(async () => {
    if (!window.ethereum) {
      alert('MetaMask or Web3 wallet not detected.');
      return;
    }
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: NETWORKS.SEPOLIA.chainIdHex }],
      });
    } catch (switchError: any) {
      if (switchError.code === 4902 || switchError?.data?.originalError?.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: NETWORKS.SEPOLIA.chainIdHex,
              chainName: NETWORKS.SEPOLIA.chainName,
              nativeCurrency: NETWORKS.SEPOLIA.nativeCurrency,
              rpcUrls: NETWORKS.SEPOLIA.rpcUrls,
              blockExplorerUrls: NETWORKS.SEPOLIA.blockExplorerUrls,
            },
          ],
        });
      } else {
        console.error('Failed to switch to Sepolia:', switchError);
        throw switchError;
      }
    }
  }, []);

  // Connect wallet
  const handleConnect = useCallback(async () => {
    if (!window.ethereum) {
      alert('Please install MetaMask or another EVM wallet.');
      return;
    }
    setIsConnecting(true);
    try {
      const provider = new BrowserProvider(window.ethereum);
      const accounts = await provider.send('eth_requestAccounts', []);
      const network = await provider.getNetwork();

      if (accounts.length > 0) {
        setAccount(accounts[0]);
      }
      setChainId(Number(network.chainId));
    } catch (err) {
      console.error('Wallet connection failed:', err);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const handleDisconnect = () => {
    setAccount(null);
    setCollateralBalance('0.00');
    setDebtBalance('0.00');
  };

  // Fetch balances for connected account
  const refreshBalances = useCallback(async () => {
    if (!account) return;

    // 1. Fetch Sepolia collateral balance (mWETH)
    try {
      const sepoliaProvider = new ethers.JsonRpcProvider(NETWORKS.SEPOLIA.rpcUrls[0]);
      const tokenContract = new Contract(
        CONTRACT_ADDRESSES.MOCK_COLLATERAL_TOKEN,
        MOCK_COLLATERAL_TOKEN_ABI,
        sepoliaProvider
      );
      const bal: bigint = await tokenContract.balanceOf(account);
      setCollateralBalance(parseFloat(ethers.formatEther(bal)).toFixed(4));
    } catch (err) {
      console.warn('Could not read mWETH balance:', err);
    }

    // 2. Fetch CC3 debt token balance (tvUSD)
    try {
      const cc3Provider = new ethers.JsonRpcProvider(NETWORKS.CREDITCOIN.rpcUrls[0]);
      const debtContract = new Contract(
        CONTRACT_ADDRESSES.DEBT_TOKEN,
        DEBT_TOKEN_ABI,
        cc3Provider
      );
      const debtBal: bigint = await debtContract.balanceOf(account);
      setDebtBalance(parseFloat(ethers.formatEther(debtBal)).toFixed(2));
    } catch (err) {
      console.warn('Could not read tvUSD balance:', err);
    }
  }, [account]);

  // Fetch positions and current price from Creditcoin CrossVault
  const refreshPositions = useCallback(async () => {
    setIsLoadingPositions(true);
    try {
      const cc3Provider = new ethers.JsonRpcProvider(NETWORKS.CREDITCOIN.rpcUrls[0]);
      const vaultContract = new Contract(
        CONTRACT_ADDRESSES.CROSS_VAULT,
        CROSS_VAULT_ABI,
        cc3Provider
      );

      // Read current price, price source, and nextPositionId
      const [rawPrice, currentSource, nextPosId]: [bigint, string, bigint] = await Promise.all([
        vaultContract.currentPrice(),
        vaultContract.priceSource(),
        vaultContract.nextPositionId(),
      ]);

      const formattedPrice = rawPrice > 0n ? ethers.formatEther(rawPrice) : '3000';
      setCurrentPrice(parseFloat(formattedPrice).toFixed(2));
      setPriceSource(currentSource || 'None');

      const totalPositions = Number(nextPosId) - 1;
      const fetchedPositions: VaultPosition[] = [];

      for (let i = 1; i <= totalPositions; i++) {
        try {
          const [pos, isLiq]: [any, boolean] = await Promise.all([
            vaultContract.positions(i),
            vaultContract.isLiquidatable(i),
          ]);

          const colEth = parseFloat(ethers.formatEther(pos.collateralAmount));
          const debtUsd = parseFloat(ethers.formatEther(pos.debtAmount));
          const priceNum = parseFloat(formattedPrice);

          let ratio: number | null = null;
          if (debtUsd > 0 && priceNum > 0) {
            ratio = ((colEth * priceNum) / debtUsd) * 100;
          }

          fetchedPositions.push({
            positionId: i,
            owner: pos.owner,
            collateralAmount: colEth.toFixed(4),
            debtAmount: debtUsd.toFixed(2),
            collateralRatio: ratio,
            liquidated: Boolean(pos.liquidated),
            repaid: Boolean(pos.repaid),
            isLiquidatable: isLiq,
          });
        } catch (posErr) {
          console.warn(`Error querying position ${i}:`, posErr);
        }
      }

      setPositions(fetchedPositions);
    } catch (err) {
      console.error('Error refreshing positions from Creditcoin:', err);
    } finally {
      setIsLoadingPositions(false);
    }
  }, []);

  const handleRefreshAll = useCallback(() => {
    refreshBalances();
    refreshPositions();
  }, [refreshBalances, refreshPositions]);

  // Handle provider events
  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length > 0) {
        setAccount(accounts[0]);
      } else {
        setAccount(null);
      }
    };

    const handleChainChanged = (chainHex: string) => {
      setChainId(parseInt(chainHex, 16));
    };

    window.ethereum.on('accountsChanged', handleAccountsChanged);
    window.ethereum.on('chainChanged', handleChainChanged);

    // Initial check
    const checkInitialConnection = async () => {
      try {
        const provider = new BrowserProvider(window.ethereum);
        const accounts = await provider.listAccounts();
        if (accounts.length > 0) {
          setAccount(accounts[0].address);
          const network = await provider.getNetwork();
          setChainId(Number(network.chainId));
        }
      } catch (err) {
        console.warn('Initial connection check failed:', err);
      }
    };

    checkInitialConnection();

    return () => {
      if (window.ethereum.removeListener) {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      }
    };
  }, []);

  // Poll state every 15s and on account changes
  useEffect(() => {
    const timer = setTimeout(() => {
      handleRefreshAll();
    }, 0);
    const interval = setInterval(handleRefreshAll, 15000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [handleRefreshAll]);

  return (
    <div className="app-layout">
      <a className="skip-link" href="#main">Skip to content</a>
      <WalletConnect
        account={account}
        chainId={chainId}
        isConnecting={isConnecting}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onSwitchToCC3={handleSwitchToCC3}
        onSwitchToSepolia={handleSwitchToSepolia}
      />

      <main id="main" className="main-content">
        <section className="identity-strip">
          <div className="identity-copy">
            <h2>Lock on Sepolia. Borrow on Creditcoin.</h2>
            <p>
              CrossVault verifies Sepolia locks through Attestcoin, then mints tvUSD
              against that proof. {account ? `Your tvUSD balance is ${debtBalance}.` : 'Connect a wallet to lock collateral.'}
            </p>
          </div>
          <aside className="custody-stamp">
            Sepolia collateral stays in escrow. Attestcoin proofs do not reverse
            custody. Repay burns tvUSD and closes the Creditcoin position. Faucet
            mints are capped at 10 mWETH per address.
          </aside>
        </section>

        <div className="grid-container">
          {/* Left Column: Actions */}
          <div className="col-left">
            <LockBorrowPanel
              account={account}
              chainId={chainId}
              collateralBalance={collateralBalance}
              currentPrice={currentPrice}
              onRefresh={handleRefreshAll}
              onSwitchToSepolia={handleSwitchToSepolia}
              getSigner={getSigner}
            />

            <PriceControl
              account={account}
              chainId={chainId}
              currentVaultPrice={currentPrice}
              priceSource={priceSource}
              onRefresh={handleRefreshAll}
              onSwitchToSepolia={handleSwitchToSepolia}
              getSigner={getSigner}
            />
          </div>

          {/* Right Column: Dashboard */}
          <div className="col-right">
            <PositionDashboard
              positions={positions}
              currentPrice={currentPrice}
              priceSource={priceSource}
              account={account}
              chainId={chainId}
              isLoading={isLoadingPositions}
              onRefresh={handleRefreshAll}
              onSwitchToCC3={handleSwitchToCC3}
              getSigner={getSigner}
            />
          </div>
        </div>
      </main>

      <footer className="footer">
        <div className="footer-links">
          <span>CollateralLock (Sepolia): <code>{CONTRACT_ADDRESSES.COLLATERAL_LOCK}</code></span>
          <span>CrossVault (Creditcoin 3): <code>{CONTRACT_ADDRESSES.CROSS_VAULT}</code></span>
        </div>
        <div className="footer-status">
          <span className="pulse-dot" /> Relayer live · cross-vault.onrender.com
        </div>
      </footer>
    </div>
  );
};

export default App;
