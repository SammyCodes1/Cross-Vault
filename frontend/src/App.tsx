import React, { useState, useEffect, useCallback } from 'react';
import { ethers, BrowserProvider, Contract } from 'ethers';
import {
  NETWORKS,
  CONTRACT_ADDRESSES,
  MOCK_COLLATERAL_TOKEN_ABI,
  DEBT_TOKEN_ABI,
  LEGACY_DEBT_TOKEN,
  LEGACY_CROSS_VAULT,
  VAULT_POSITION_ABI,
  LEGACY_VAULT_POSITION_ABI,
  LEDGER_VAULTS,
} from './contracts/config';
import { loadPositionMeta } from './lib/session';
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
  const refreshSeq = React.useRef(0);

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
    const sepoliaChain = {
      chainId: NETWORKS.SEPOLIA.chainIdHex,
      chainName: NETWORKS.SEPOLIA.chainName,
      nativeCurrency: NETWORKS.SEPOLIA.nativeCurrency,
      rpcUrls: [...NETWORKS.SEPOLIA.rpcUrls],
      blockExplorerUrls: NETWORKS.SEPOLIA.blockExplorerUrls,
    };
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: NETWORKS.SEPOLIA.chainIdHex }],
      });
    } catch (switchError: any) {
      if (switchError.code === 4902 || switchError?.data?.originalError?.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [sepoliaChain],
        });
        return;
      }
      console.error('Failed to switch to Sepolia:', switchError);
      throw switchError;
    }
    try {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [sepoliaChain],
      });
    } catch {
      /* chain already present; RPC update is wallet-dependent */
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
      let legacyBal = 0n;
      try {
        const legacyDebt = new Contract(LEGACY_DEBT_TOKEN, DEBT_TOKEN_ABI, cc3Provider);
        legacyBal = await legacyDebt.balanceOf(account);
      } catch {
        legacyBal = 0n;
      }
      setDebtBalance(parseFloat(ethers.formatEther(debtBal + legacyBal)).toFixed(2));
    } catch (err) {
      console.warn('Could not read tvUSD balance:', err);
    }
  }, [account]);

  const loadPositionsFromVault = async (
    vaultAddress: string,
    provider: ethers.Provider
  ): Promise<{ positions: VaultPosition[]; price: string | null; source: string | null }> => {
    const isLegacy4 = vaultAddress.toLowerCase() === LEGACY_CROSS_VAULT.toLowerCase();
    const abi = isLegacy4 ? LEGACY_VAULT_POSITION_ABI : VAULT_POSITION_ABI;
    const vault = new Contract(vaultAddress, abi, provider);
    const [rawPrice, currentSource, nextPosId] = await Promise.all([
      vault.currentPrice(),
      vault.priceSource().catch(() => 'None'),
      vault.nextPositionId(),
    ]);
    const formattedPrice = rawPrice > 0n ? ethers.formatEther(rawPrice) : '0';
    const priceNum = parseFloat(formattedPrice);
    const total = Number(nextPosId) - 1;
    if (total <= 0) {
      return {
        positions: [],
        price: rawPrice > 0n ? priceNum.toFixed(2) : null,
        source: currentSource || null,
      };
    }

    const posPromises: Promise<VaultPosition | null>[] = [];
    for (let i = 1; i <= total; i++) {
      posPromises.push(
        (async () => {
          try {
            const [pos, isLiq] = await Promise.all([
              vault.positions(i),
              vault.isLiquidatable(i).catch(() => false),
            ]);
            const colEth = parseFloat(ethers.formatEther(pos.collateralAmount ?? pos[1] ?? 0n));
            const debtUsd = parseFloat(ethers.formatEther(pos.debtAmount ?? pos[2] ?? 0n));
            let ratio: number | null = null;
            if (debtUsd > 0 && priceNum > 0) {
              ratio = ((colEth * priceNum) / debtUsd) * 100;
            }
            const isRepaid = pos.length > 4 ? Boolean(pos[4]) : Boolean(pos.repaid ?? false);
            const isLiquidated = Boolean(pos.liquidated ?? (pos.length > 3 ? pos[3] : false));
            const meta = loadPositionMeta(vaultAddress, i);
            const lockId = Number((pos.length > 5 ? pos[5] : undefined) ?? meta.lockId ?? 0) || undefined;
            return {
              positionId: i,
              owner: pos.owner ?? pos[0],
              collateralAmount: colEth.toFixed(4),
              debtAmount: debtUsd.toFixed(2),
              collateralRatio: ratio,
              liquidated: isLiquidated,
              repaid: isRepaid,
              isLiquidatable: Boolean(isLiq),
              vault: vaultAddress,
              lockId,
              sepoliaTx: meta.sepoliaTx,
              cc3Tx: meta.cc3Tx,
            };
          } catch (posErr) {
            console.warn(`Error querying position ${i} on ${vaultAddress}:`, posErr);
            return null;
          }
        })()
      );
    }

    const resolved = await Promise.all(posPromises);
    const rows = resolved.filter((r): r is VaultPosition => r !== null);

    return {
      positions: rows,
      price: rawPrice > 0n ? priceNum.toFixed(2) : null,
      source: currentSource || null,
    };
  };

  const refreshPositions = useCallback(async () => {
    const seq = ++refreshSeq.current;
    setIsLoadingPositions(true);
    try {
      const cc3Provider = new ethers.JsonRpcProvider(NETWORKS.CREDITCOIN.rpcUrls[0]);
      const uniqueVaults = [...new Set(LEDGER_VAULTS.map((a) => a.toLowerCase()))];
      const batches = await Promise.all(
        uniqueVaults.map((addr) =>
          loadPositionsFromVault(ethers.getAddress(addr), cc3Provider).catch((err) => {
            console.warn('Ledger vault read failed', addr, err);
            return { positions: [] as VaultPosition[], price: null, source: null };
          })
        )
      );

      if (seq !== refreshSeq.current) return;
      const primary = batches[0];
      const rows = batches.flatMap((b) => b.positions);
      setCurrentPrice(primary.price && primary.price !== '0.00' ? primary.price : '2550.71');
      setPriceSource(primary.source || 'None');
      setPositions(rows);
    } catch (err) {
      console.error('Error refreshing positions from Creditcoin:', err);
    } finally {
      if (seq === refreshSeq.current) setIsLoadingPositions(false);
    }
  }, []);

  const upsertPosition = useCallback((row: VaultPosition) => {
    const allowed = LEDGER_VAULTS.map((a) => a.toLowerCase());
    if (!allowed.includes(row.vault.toLowerCase())) return;
    setPositions((prev) => {
      const key = `${row.vault.toLowerCase()}-${row.positionId}`;
      const rest = prev.filter((p) => `${p.vault.toLowerCase()}-${p.positionId}` !== key);
      return [row, ...rest];
    });
  }, []);

  const handleRefreshAll = useCallback(() => {
    refreshBalances();
    void refreshPositions();
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
        {account ? (
          <section className="balance-bar" aria-label="Balances">
            <div className="balance-chip">
              <span>mWETH</span>
              <strong>{collateralBalance}</strong>
            </div>
            <div className="balance-chip">
              <span>tvUSD</span>
              <strong>{debtBalance}</strong>
            </div>
          </section>
        ) : null}

        <div className="grid-container">
          {/* Left Column: Actions */}
          <div className="col-left">
            <LockBorrowPanel
              account={account}
              chainId={chainId}
              collateralBalance={collateralBalance}
              currentPrice={currentPrice}
              onRefresh={handleRefreshAll}
              onPositionOpened={upsertPosition}
              onSwitchToSepolia={handleSwitchToSepolia}
              getSigner={getSigner}
            />

            <PriceControl
              currentVaultPrice={currentPrice}
              priceSource={priceSource}
              onRefresh={handleRefreshAll}
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
              onSwitchToSepolia={handleSwitchToSepolia}
              getSigner={getSigner}
            />
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
