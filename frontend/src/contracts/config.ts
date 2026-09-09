export const NETWORKS = {
  SEPOLIA: {
    chainId: 11155111,
    chainIdHex: '0xaa36a7',
    chainName: 'Sepolia',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: ['https://ethereum-sepolia-rpc.publicnode.com'],
    blockExplorerUrls: ['https://sepolia.etherscan.io'],
  },
  CREDITCOIN: {
    chainId: 102031,
    chainIdHex: '0x18E8F',
    chainName: 'Creditcoin Testnet',
    nativeCurrency: { name: 'tCTC', symbol: 'tCTC', decimals: 18 },
    rpcUrls: ['https://rpc.cc3-testnet.creditcoin.network'],
    blockExplorerUrls: ['https://creditcoin-testnet.blockscout.com'],
  },
} as const;

export const CONTRACT_ADDRESSES = {
  // Sepolia (Chain ID 11155111)
  MOCK_COLLATERAL_TOKEN: '0x208Af80035A2009Ec0373264623E417C2c26c6eB',
  COLLATERAL_LOCK: '0x819068a43Ec7f7367B025B7dF0FAbeAdf70F173f',
  MOCK_PRICE_FEED: '0x5Eb309a76C6E993293CD756d938BBb35F3bFd35f',

  // Creditcoin 3 Testnet (Chain ID 102031)
  DEBT_TOKEN: '0xD709d29D35D99370f75770fC48dBEa3aE6277eB4',
  CROSS_VAULT: '0x4D7F912075EF21A400125821f1dA303DF7e1444A',
} as const;

export const RELAYER_BASE_URL =
  (import.meta.env.VITE_RELAYER_URL as string) || 'http://localhost:3001';

export const MOCK_COLLATERAL_TOKEN_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function mint(address to, uint256 amount) external',
];

export const COLLATERAL_LOCK_ABI = [
  'function token() view returns (address)',
  'function nextLockId() view returns (uint256)',
  'function lock(uint256 amount) returns (uint256)',
  'function getLock(uint256 lockId) view returns (tuple(address owner, uint256 amount, bool active))',
  'event Locked(uint256 indexed lockId, address indexed owner, uint256 amount, uint256 timestamp)',
];

export const MOCK_PRICE_FEED_ABI = [
  'function owner() view returns (address)',
  'function getPrice() view returns (uint256)',
  'function setPrice(uint256 newPrice) external',
  'event PriceUpdated(uint256 price, uint256 timestamp)',
];

export const CROSS_VAULT_ABI = [
  'function currentPrice() view returns (uint256)',
  'function priceSource() view returns (string)',
  'function PYTH_CONTRACT_SEPOLIA() view returns (address)',
  'function PYTH_ETH_FEED_ID() view returns (bytes32)',
  'function nextPositionId() view returns (uint256)',
  'function positions(uint256 positionId) view returns (address owner, uint256 collateralAmount, uint256 debtAmount, bool liquidated)',
  'function getPosition(uint256 positionId) view returns (tuple(address owner, uint256 collateralAmount, uint256 debtAmount, bool liquidated))',
  'function isLiquidatable(uint256 positionId) view returns (bool)',
  'function liquidate(uint256 positionId) external',
  'function collateralLock() view returns (address)',
  'function priceFeed() view returns (address)',
  'function debtToken() view returns (address)',
  'function usedLockIds(uint256) view returns (bool)',
  'event PositionOpened(uint256 indexed positionId, address indexed owner, uint256 indexed lockId, uint256 collateralAmount, uint256 debtAmount)',
  'event PriceUpdated(uint256 newPrice, uint256 timestamp)',
  'event PriceUpdatedFromPyth(uint256 newPrice, int64 rawPrice, int32 expo, uint256 timestamp)',
  'event Liquidated(uint256 indexed positionId, address indexed liquidator)',
];

export const DEBT_TOKEN_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];
