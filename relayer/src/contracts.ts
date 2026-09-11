import { ethers } from 'ethers';

export const COLLATERAL_LOCK_ABI = [
  'event Locked(uint256 indexed lockId, address indexed owner, uint256 amount, uint256 timestamp)',
  'function lock(uint256 amount) external',
  'function getLock(uint256 lockId) external view returns (tuple(address owner, uint256 amount, bool active))',
  'function collateralToken() external view returns (address)',
  'function nextLockId() external view returns (uint256)',
];

export const MOCK_PRICE_FEED_ABI = [
  'event PriceUpdated(uint256 price, uint256 timestamp)',
  'function setPrice(uint256 newPrice) external',
  'function getPrice() external view returns (uint256)',
  'function owner() external view returns (address)',
];

export const MOCK_COLLATERAL_TOKEN_ABI = [
  'function mint(address to, uint256 amount) external',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
];

export const CROSS_VAULT_ABI = [
  'function openPosition(uint256 lockId, tuple(uint64 height, bytes encodedTx, tuple(bytes32 root, tuple(bytes32 hash, bool isLeft)[] siblings) merkleProof, tuple(bytes32 lowerEndpointDigest, bytes32[] roots) continuityProof) proof) external returns (uint256 positionId)',
  'function updatePrice(tuple(uint64 height, bytes encodedTx, tuple(bytes32 root, tuple(bytes32 hash, bool isLeft)[] siblings) merkleProof, tuple(bytes32 lowerEndpointDigest, bytes32[] roots) continuityProof) proof) external',
  'function updatePriceFromPyth(tuple(uint64 height, bytes encodedTx, tuple(bytes32 root, tuple(bytes32 hash, bool isLeft)[] siblings) merkleProof, tuple(bytes32 lowerEndpointDigest, bytes32[] roots) continuityProof) proof) external',
  'function getPosition(uint256 positionId) external view returns (tuple(address owner, uint256 collateralAmount, uint256 debtAmount, bool liquidated, bool repaid))',
  'function positions(uint256 positionId) external view returns (address owner, uint256 collateralAmount, uint256 debtAmount, bool liquidated, bool repaid)',
  'function isLiquidatable(uint256 positionId) external view returns (bool)',
  'function liquidate(uint256 positionId) external',
  'function repay(uint256 positionId) external',
  'function currentPrice() external view returns (uint256)',
  'function priceSource() external view returns (string)',
  'function nextPositionId() external view returns (uint256)',
  'function usedLockIds(uint256 lockId) external view returns (bool)',
  'function usedPriceProofs(bytes32 proofId) external view returns (bool)',
  'function collateralLock() external view returns (address)',
  'function priceFeed() external view returns (address)',
  'function debtToken() external view returns (address)',
  'function sepoliaChainKey() external view returns (uint64)',
  'function PYTH_CONTRACT_SEPOLIA() external view returns (address)',
  'function PYTH_ETH_FEED_ID() external view returns (bytes32)',
  'event PositionOpened(uint256 indexed positionId, address indexed owner, uint256 indexed lockId, uint256 collateralAmount, uint256 debtAmount)',
  'event PriceUpdated(uint256 newPrice, uint256 timestamp)',
  'event PriceUpdatedFromPyth(uint256 newPrice, int64 rawPrice, int32 expo, uint256 timestamp)',
  'event Liquidated(uint256 indexed positionId, address indexed liquidator)',
  'event Repaid(uint256 indexed positionId, address indexed owner)',
  'error VerificationFailed()',
  'error LockAlreadyUsed()',
  'error ProofAlreadyUsed()',
  'error LockIdMismatch()',
  'error PriceNotSet()',
  'error InvalidAmount()',
  'error InvalidOwner()',
  'error InvalidPrice()',
  'error InvalidEventData()',
  'error NotLiquidatable()',
  'error WrongContract()',
  'error WrongFeedId()',
];

export const PYTH_CONTRACT_SEPOLIA = '0xBb86bCc951A62DF86826219d9251Ee05F2c1e286';
export const PYTH_ETH_FEED_ID = '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace';

export const IPYTH_ABI = [
  'event PriceFeedUpdate(bytes32 indexed id, uint64 publishTime, int64 price, uint64 conf)',
  'function getPriceUnsafe(bytes32 id) external view returns (tuple(int64 price, uint64 conf, int32 expo, uint256 publishTime))',
];

export const pythInterface = new ethers.Interface(IPYTH_ABI);

export const DEBT_TOKEN_ABI = [
  'function name() external view returns (string)',
  'function symbol() external view returns (string)',
  'function decimals() external view returns (uint8)',
  'function totalSupply() external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) external returns (bool)',
  'function vault() external view returns (address)',
];

export const crossVaultInterface = new ethers.Interface(CROSS_VAULT_ABI);
export const collateralLockInterface = new ethers.Interface(COLLATERAL_LOCK_ABI);
export const mockPriceFeedInterface = new ethers.Interface(MOCK_PRICE_FEED_ABI);

/**
 * Decodes transaction revert reason from an ethers error, matching custom contract errors.
 */
export function decodeRevertReason(error: any, iface: ethers.Interface = crossVaultInterface): string {
  if (!error) return 'Transaction reverted';

  // Check nested error data paths commonly populated by ethers v6
  const data =
    error.data ||
    error.info?.error?.data ||
    error.error?.data ||
    error.transaction?.data ||
    error.receipt?.data;

  if (data && typeof data === 'string') {
    try {
      const parsed = iface.parseError(data);
      if (parsed) {
        return parsed.name;
      }
    } catch {}
  }

  // Check error message for custom error names
  const customErrors = [
    'VerificationFailed',
    'LockAlreadyUsed',
    'ProofAlreadyUsed',
    'LockIdMismatch',
    'PriceNotSet',
    'InvalidAmount',
    'InvalidOwner',
    'InvalidPrice',
    'InvalidEventData',
    'NotLiquidatable',
    'WrongContract',
    'WrongFeedId',
  ];

  const fullErrStr = (error.message || '') + ' ' + (error.shortMessage || '') + ' ' + (error.reason || '');
  for (const customError of customErrors) {
    if (fullErrStr.includes(customError)) {
      return customError;
    }
  }

  if (error.reason) return error.reason;
  if (error.shortMessage) return error.shortMessage;
  if (error.message) return error.message;

  return 'Transaction reverted';
}
