export const NETWORKS = {
  SEPOLIA: {
    chainId: 11155111,
    chainIdHex: '0xaa36a7',
    chainName: 'Sepolia',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://rpc.sepolia.org',
      'https://1rpc.io/sepolia',
    ],
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
  COLLATERAL_LOCK: '0x1eA40aB9658795c329Bc29D9bf553b8a6ede724f',
  MOCK_PRICE_FEED: '0x5Eb309a76C6E993293CD756d938BBb35F3bFd35f',

  // Creditcoin 3 Testnet (Chain ID 102031)
  DEBT_TOKEN: '0x43F347697c52002bB5a845651444D892806D41c3',
  CROSS_VAULT: '0x06a611B840f55b40c8d5c4130478f626cCcC421f',
} as const;

/** Vaults the ledger reads. Current first, then the Pyth vault that already has positions, then legacy. */
export const LEDGER_VAULTS = [
  '0x06a611B840f55b40c8d5c4130478f626cCcC421f',
  '0x7AC8AAfFb8763581B5a28E466359c5DE070E3BC3',
  '0x4D7F912075EF21A400125821f1dA303DF7e1444A',
] as const;

/** Previous CC3 vault. Hosted relayer still opened positions here. */
export const LEGACY_CROSS_VAULT = '0x4D7F912075EF21A400125821f1dA303DF7e1444A';
export const LEGACY_DEBT_TOKEN = '0xD709d29D35D99370f75770fC48dBEa3aE6277eB4';

export const VAULT_POSITION_ABI = [
  'function nextPositionId() view returns (uint256)',
  'function currentPrice() view returns (uint256)',
  'function priceSource() view returns (string)',
  'function positions(uint256 positionId) view returns (address owner, uint256 collateralAmount, uint256 debtAmount, bool liquidated, bool repaid)',
  'function isLiquidatable(uint256 positionId) view returns (bool)',
];

export const LEGACY_VAULT_POSITION_ABI = [
  'function nextPositionId() view returns (uint256)',
  'function currentPrice() view returns (uint256)',
  'function priceSource() view returns (string)',
  'function positions(uint256 positionId) view returns (address owner, uint256 collateralAmount, uint256 debtAmount, bool liquidated)',
  'function isLiquidatable(uint256 positionId) view returns (bool)',
];

export const RELAYER_BASE_URL =
  (import.meta.env.VITE_RELAYER_URL as string) || 'https://cross-vault.onrender.com';

export const PYTH_CONTRACT_SEPOLIA = '0xBb86bCc951A62DF86826219d9251Ee05F2c1e286';
export const PYTH_ETH_FEED_ID =
  '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace';

export const IPYTH_ABI = [
  'function getPriceUnsafe(bytes32 id) view returns (tuple(int64 price, uint64 conf, int32 expo, uint256 publishTime))',
];

export const MOCK_COLLATERAL_TOKEN_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function mint(address to, uint256 amount) external',
  'function minted(address account) view returns (uint256)',
  'function FAUCET_MAX() view returns (uint256)',
];

export const COLLATERAL_LOCK_ABI = [
  'function token() view returns (address)',
  'function nextLockId() view returns (uint256)',
  'function lock(uint256 amount) returns (uint256)',
  'function unlock(uint256 lockId) external',
  'function getLock(uint256 lockId) view returns (tuple(address owner, uint256 amount, bool active))',
  'event Locked(uint256 indexed lockId, address indexed owner, uint256 amount, uint256 timestamp)',
  'event Unlocked(uint256 indexed lockId, address indexed owner, uint256 amount)',
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
  'function positions(uint256 positionId) view returns (address owner, uint256 collateralAmount, uint256 debtAmount, bool liquidated, bool repaid, uint256 lockId)',
  'function getPosition(uint256 positionId) view returns (tuple(address owner, uint256 collateralAmount, uint256 debtAmount, bool liquidated, bool repaid, uint256 lockId))',
  'function isLiquidatable(uint256 positionId) view returns (bool)',
  'function liquidate(uint256 positionId) external',
  'function repay(uint256 positionId) external',
  'function MAX_PRICE() view returns (uint256)',
  'function collateralLock() view returns (address)',
  'function priceFeed() view returns (address)',
  'function debtToken() view returns (address)',
  'function usedLockIds(uint256) view returns (bool)',
  'event PositionOpened(uint256 indexed positionId, address indexed owner, uint256 indexed lockId, uint256 collateralAmount, uint256 debtAmount)',
  'event PriceUpdated(uint256 newPrice, uint256 timestamp)',
  'event PriceUpdatedFromPyth(uint256 newPrice, int64 rawPrice, int32 expo, uint256 timestamp)',
  'event Liquidated(uint256 indexed positionId, address indexed liquidator)',
  'event Repaid(uint256 indexed positionId, address indexed owner)',
];

export const DEBT_TOKEN_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];
