import express, { Request, Response } from 'express';
import cors from 'cors';
import { ethers } from 'ethers';
import {
  SEPOLIA_RPC_URL,
  CC3_TESTNET_RPC_URL,
  CC3_PRIVATE_KEY,
  getDeployedSepolia,
  getDeployedCreditcoin,
} from './config';
import {
  CROSS_VAULT_ABI,
  COLLATERAL_LOCK_ABI,
  MOCK_PRICE_FEED_ABI,
  crossVaultInterface,
  collateralLockInterface,
  mockPriceFeedInterface,
  pythInterface,
  PYTH_CONTRACT_SEPOLIA,
  PYTH_ETH_FEED_ID,
  decodeRevertReason,
} from './contracts';
import { fetchSepoliaProof, TxProofPayload } from './prover';

export interface RelayerDependencies {
  fetchProof?: (txHash: string, blockHeight: number) => Promise<TxProofPayload>;
  getSepoliaLogs?: (params: ethers.Filter) => Promise<ethers.Log[]>;
  submitOpenPosition?: (
    crossVaultAddress: string,
    lockId: bigint,
    proof: TxProofPayload
  ) => Promise<{ hash: string; positionId: string }>;
  submitUpdatePrice?: (
    crossVaultAddress: string,
    proof: TxProofPayload
  ) => Promise<{ hash: string }>;
  submitUpdatePriceFromPyth?: (
    crossVaultAddress: string,
    proof: TxProofPayload
  ) => Promise<{ hash: string }>;
}

const ATTEST_RATE_MAX = 8;
const ATTEST_RATE_WINDOW_MS = 60_000;

function createAttestRateLimiter() {
  const hits = new Map<string, number[]>();
  return function allowAttest(req: Request, res: Response): boolean {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < ATTEST_RATE_WINDOW_MS);
    if (recent.length >= ATTEST_RATE_MAX) {
      res.status(429).json({ error: 'Rate limit exceeded' });
      return false;
    }
    recent.push(now);
    hits.set(ip, recent);
    return true;
  };
}

export function createRelayerApp(deps: RelayerDependencies = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  const allowAttest = createAttestRateLimiter();

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'crossvault-relayer',
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * POST /attest/lock/:lockId
   * Finds the Locked log on Sepolia, requests proof from USC Prover API,
   * and submits openPosition on Creditcoin 3 CrossVault.
   */
  app.post('/attest/lock/:lockId', async (req: Request, res: Response) => {
    if (!allowAttest(req, res)) return;
    const { lockId } = req.params;
    let lockIdBigInt: bigint;
    try {
      lockIdBigInt = BigInt(lockId);
    } catch {
      return res.status(400).json({ error: `Invalid lockId parameter: ${lockId}` });
    }

    console.log(`[Relayer] Attesting lock for lockId: ${lockId}`);

    // 1. Read deployed addresses
    const sepoliaDeployments = getDeployedSepolia();
    const creditcoinDeployments = getDeployedCreditcoin();

    const collateralLockAddress =
      sepoliaDeployments.collateralLock || sepoliaDeployments.CollateralLock;
    const crossVaultAddress =
      creditcoinDeployments.crossVault || creditcoinDeployments.CrossVault;

    if (!collateralLockAddress) {
      return res.status(500).json({
        error: 'CollateralLock address not found in deployed-sepolia.json',
      });
    }

    if (!crossVaultAddress) {
      return res.status(500).json({
        error: 'CrossVault address not found in deployed-creditcoin.json',
      });
    }

    // 2. Query Sepolia for Locked event log matching lockId
    let targetLog: ethers.Log | null = null;
    try {
      const lockedEventTopic = collateralLockInterface.getEvent('Locked')!.topicHash;
      const lockIdTopic = ethers.zeroPadValue(ethers.toBeHex(lockIdBigInt), 32);

      let logs: ethers.Log[];
      if (deps.getSepoliaLogs) {
        logs = await deps.getSepoliaLogs({
          address: collateralLockAddress,
          topics: [lockedEventTopic, lockIdTopic],
        });
      } else {
        const sepoliaProvider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
        const latestBlock = await sepoliaProvider.getBlockNumber();
        const fromBlock = Math.max(0, latestBlock - 50000);

        logs = await sepoliaProvider.getLogs({
          address: collateralLockAddress,
          topics: [lockedEventTopic, lockIdTopic],
          fromBlock,
          toBlock: 'latest',
        });
      }

      if (logs && logs.length > 0) {
        targetLog = logs[0];
      }
    } catch (err: any) {
      console.error(`[Relayer] Error fetching Sepolia logs for lockId ${lockId}:`, err);
      return res.status(500).json({
        error: `Failed to query Sepolia logs: ${err.message}`,
      });
    }

    if (!targetLog) {
      console.warn(`[Relayer] Locked event not found on Sepolia for lockId ${lockId}`);
      return res.status(404).json({
        error: `Sepolia Locked event log not found for lockId ${lockId}`,
      });
    }

    const blockNumber = targetLog.blockNumber;
    const transactionHash = targetLog.transactionHash;
    console.log(`[Relayer] Found Locked log at block ${blockNumber}, tx ${transactionHash}`);

    // 3. Request proof from USC Prover API
    let proof: TxProofPayload;
    try {
      const fetchProofFn = deps.fetchProof || fetchSepoliaProof;
      proof = await fetchProofFn(transactionHash, blockNumber);
    } catch (err: any) {
      console.error(`[Relayer] Prover API error for tx ${transactionHash}:`, err);
      return res.status(502).json({
        error: `USC Prover API failed: ${err.message || 'Unknown error'}`,
      });
    }

    // 4. Submit proof to CrossVault.openPosition on Creditcoin 3
    try {
      if (deps.submitOpenPosition) {
        const result = await deps.submitOpenPosition(crossVaultAddress, lockIdBigInt, proof);
        return res.status(200).json({
          success: true,
          transactionHash: result.hash,
          positionId: result.positionId,
        });
      }

      if (!CC3_PRIVATE_KEY) {
        return res.status(500).json({
          error: 'CC3_PRIVATE_KEY is not configured in environment',
        });
      }

      const cc3Provider = new ethers.JsonRpcProvider(CC3_TESTNET_RPC_URL);
      const signer = new ethers.Wallet(CC3_PRIVATE_KEY, cc3Provider);
      const crossVault = new ethers.Contract(crossVaultAddress, CROSS_VAULT_ABI, signer);

      console.log(`[Relayer] Submitting openPosition(${lockId}) to CrossVault at ${crossVaultAddress}...`);
      const tx = await crossVault.openPosition(lockIdBigInt, proof);
      console.log(`[Relayer] Transaction broadcast: ${tx.hash}. Waiting for confirmation...`);
      const receipt = await tx.wait();

      // Decode positionId from PositionOpened event or query view
      let positionId: string | null = null;
      if (receipt && receipt.logs) {
        for (const log of receipt.logs) {
          try {
            const parsed = crossVaultInterface.parseLog(log);
            if (parsed && parsed.name === 'PositionOpened') {
              positionId = parsed.args.positionId.toString();
              break;
            }
          } catch {}
        }
      }

      if (!positionId) {
        try {
          const nextId: bigint = await crossVault.nextPositionId();
          positionId = (nextId - 1n).toString();
        } catch {}
      }

      console.log(`[Relayer] Successfully opened position #${positionId} in tx ${receipt.hash}`);
      return res.status(200).json({
        success: true,
        transactionHash: receipt.hash,
        positionId: positionId || 'unknown',
      });
    } catch (err: any) {
      const decodedReason = decodeRevertReason(err, crossVaultInterface);
      console.error(`[Relayer] openPosition reverted: ${decodedReason}`, err);
      return res.status(409).json({
        error: decodedReason,
      });
    }
  });

  /**
   * POST /attest/price
   * Fetches the latest PriceUpdated log from MockPriceFeed on Sepolia,
   * gets a proof, and submits it to CrossVault.updatePrice on CC3.
   */
  app.post('/attest/price', async (req: Request, res: Response) => {
    if (!allowAttest(req, res)) return;
    console.log('[Relayer] Attesting latest price update from Sepolia');

    // 1. Read deployed addresses
    const sepoliaDeployments = getDeployedSepolia();
    const creditcoinDeployments = getDeployedCreditcoin();

    const priceFeedAddress =
      sepoliaDeployments.mockPriceFeed || sepoliaDeployments.MockPriceFeed;
    const crossVaultAddress =
      creditcoinDeployments.crossVault || creditcoinDeployments.CrossVault;

    if (!priceFeedAddress) {
      return res.status(500).json({
        error: 'MockPriceFeed address not found in deployed-sepolia.json',
      });
    }

    if (!crossVaultAddress) {
      return res.status(500).json({
        error: 'CrossVault address not found in deployed-creditcoin.json',
      });
    }

    // 2. Query Sepolia for latest PriceUpdated event log
    let targetLog: ethers.Log | null = null;
    try {
      const priceUpdatedEventTopic = mockPriceFeedInterface.getEvent('PriceUpdated')!.topicHash;

      let logs: ethers.Log[];
      if (deps.getSepoliaLogs) {
        logs = await deps.getSepoliaLogs({
          address: priceFeedAddress,
          topics: [priceUpdatedEventTopic],
        });
      } else {
        const sepoliaProvider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
        const latestBlock = await sepoliaProvider.getBlockNumber();
        const fromBlock = Math.max(0, latestBlock - 50000);

        logs = await sepoliaProvider.getLogs({
          address: priceFeedAddress,
          topics: [priceUpdatedEventTopic],
          fromBlock,
          toBlock: 'latest',
        });
      }

      if (logs && logs.length > 0) {
        targetLog = logs[logs.length - 1];
      }
    } catch (err: any) {
      console.error('[Relayer] Error querying Sepolia PriceUpdated logs:', err);
      return res.status(500).json({
        error: `Failed to query Sepolia logs: ${err.message}`,
      });
    }

    if (!targetLog) {
      console.warn('[Relayer] PriceUpdated event log not found on Sepolia');
      return res.status(404).json({
        error: 'Sepolia PriceUpdated event log not found',
      });
    }

    const blockNumber = targetLog.blockNumber;
    const transactionHash = targetLog.transactionHash;
    console.log(`[Relayer] Found PriceUpdated log at block ${blockNumber}, tx ${transactionHash}`);

    // 3. Request proof from USC Prover API
    let proof: TxProofPayload;
    try {
      const fetchProofFn = deps.fetchProof || fetchSepoliaProof;
      proof = await fetchProofFn(transactionHash, blockNumber);
    } catch (err: any) {
      console.error(`[Relayer] Prover API error for tx ${transactionHash}:`, err);
      return res.status(502).json({
        error: `USC Prover API failed: ${err.message || 'Unknown error'}`,
      });
    }

    // 4. Submit proof to CrossVault.updatePrice on Creditcoin 3
    try {
      if (deps.submitUpdatePrice) {
        const result = await deps.submitUpdatePrice(crossVaultAddress, proof);
        return res.status(200).json({
          success: true,
          transactionHash: result.hash,
        });
      }

      if (!CC3_PRIVATE_KEY) {
        return res.status(500).json({
          error: 'CC3_PRIVATE_KEY is not configured in environment',
        });
      }

      const cc3Provider = new ethers.JsonRpcProvider(CC3_TESTNET_RPC_URL);
      const signer = new ethers.Wallet(CC3_PRIVATE_KEY, cc3Provider);
      const crossVault = new ethers.Contract(crossVaultAddress, CROSS_VAULT_ABI, signer);

      console.log(`[Relayer] Submitting updatePrice to CrossVault at ${crossVaultAddress}...`);
      const tx = await crossVault.updatePrice(proof);
      console.log(`[Relayer] Transaction broadcast: ${tx.hash}. Waiting for confirmation...`);
      const receipt = await tx.wait();

      console.log(`[Relayer] Successfully updated price on CrossVault in tx ${receipt.hash}`);
      return res.status(200).json({
        success: true,
        transactionHash: receipt.hash,
      });
    } catch (err: any) {
      const decodedReason = decodeRevertReason(err, crossVaultInterface);
      console.error(`[Relayer] updatePrice reverted: ${decodedReason}`, err);
      return res.status(409).json({
        error: decodedReason,
      });
    }
  });

  /**
   * POST /attest/price/pyth
   * Fetches the latest PriceFeedUpdate log for Pyth ETH/USD feed on Sepolia (or from optional txHash/blockNumber),
   * gets a proof from the USC Prover API, and submits it to CrossVault.updatePriceFromPyth on CC3.
   */
  app.post('/attest/price/pyth', async (req: Request, res: Response) => {
    if (!allowAttest(req, res)) return;
    console.log('[Relayer] Attesting latest Pyth price update from Sepolia');

    // 1. Read deployed addresses
    const creditcoinDeployments = getDeployedCreditcoin();
    const crossVaultAddress =
      creditcoinDeployments.crossVault || creditcoinDeployments.CrossVault;

    if (!crossVaultAddress) {
      return res.status(500).json({
        error: 'CrossVault address not found in deployed-creditcoin.json',
      });
    }

    let blockNumber: number | null = null;
    let transactionHash: string | null = null;

    try {
      const priceFeedUpdateTopic = pythInterface.getEvent('PriceFeedUpdate')!.topicHash;
      const feedIdTopic = PYTH_ETH_FEED_ID;

      let logs: ethers.Log[];
      if (deps.getSepoliaLogs) {
        logs = await deps.getSepoliaLogs({
          address: PYTH_CONTRACT_SEPOLIA,
          topics: [priceFeedUpdateTopic, feedIdTopic],
        });
      } else {
        const sepoliaProvider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
        const latestBlock = await sepoliaProvider.getBlockNumber();
        const fromBlock = Math.max(0, latestBlock - 50000);

        logs = await sepoliaProvider.getLogs({
          address: PYTH_CONTRACT_SEPOLIA,
          topics: [priceFeedUpdateTopic, feedIdTopic],
          fromBlock,
          toBlock: 'latest',
        });
      }

      if (logs && logs.length > 0) {
        const targetLog = logs[logs.length - 1];
        blockNumber = targetLog.blockNumber;
        transactionHash = targetLog.transactionHash;
      }
    } catch (err: any) {
      console.error('[Relayer] Error querying Sepolia Pyth PriceFeedUpdate logs:', err);
      return res.status(500).json({
        error: `Failed to query Sepolia logs: ${err.message}`,
      });
    }

    if (!transactionHash || blockNumber === null) {
      console.warn('[Relayer] Pyth PriceFeedUpdate event log not found on Sepolia');
      return res.status(404).json({
        error: 'Sepolia Pyth PriceFeedUpdate event log not found',
      });
    }

    console.log(`[Relayer] Found Pyth PriceFeedUpdate log at block ${blockNumber}, tx ${transactionHash}`);

    // 2. Request proof from USC Prover API
    let proof: TxProofPayload;
    try {
      const fetchProofFn = deps.fetchProof || fetchSepoliaProof;
      proof = await fetchProofFn(transactionHash, blockNumber);
    } catch (err: any) {
      console.error(`[Relayer] Prover API error for Pyth tx ${transactionHash}:`, err);
      return res.status(502).json({
        error: `USC Prover API failed: ${err.message || 'Unknown error'}`,
      });
    }

    // 3. Submit proof to CrossVault.updatePriceFromPyth on Creditcoin 3
    try {
      if (deps.submitUpdatePriceFromPyth) {
        const result = await deps.submitUpdatePriceFromPyth(crossVaultAddress, proof);
        return res.status(200).json({
          success: true,
          transactionHash: result.hash,
          source: 'Pyth',
        });
      }

      if (!CC3_PRIVATE_KEY) {
        return res.status(500).json({
          error: 'CC3_PRIVATE_KEY is not configured in environment',
        });
      }

      const cc3Provider = new ethers.JsonRpcProvider(CC3_TESTNET_RPC_URL);
      const signer = new ethers.Wallet(CC3_PRIVATE_KEY, cc3Provider);
      const crossVault = new ethers.Contract(crossVaultAddress, CROSS_VAULT_ABI, signer);

      console.log(`[Relayer] Submitting updatePriceFromPyth to CrossVault at ${crossVaultAddress}...`);
      const tx = await crossVault.updatePriceFromPyth(proof, { gasPrice: 2000000000n });
      console.log(`[Relayer] Transaction broadcast: ${tx.hash}. Waiting for confirmation...`);
      const receipt = await tx.wait();

      console.log(`[Relayer] Successfully updated Pyth price on CrossVault in tx ${receipt.hash}`);
      return res.status(200).json({
        success: true,
        transactionHash: receipt.hash,
        source: 'Pyth',
      });
    } catch (err: any) {
      const decodedReason = decodeRevertReason(err, crossVaultInterface);
      console.error(`[Relayer] updatePriceFromPyth reverted: ${decodedReason}`, err);
      return res.status(409).json({
        error: decodedReason,
      });
    }
  });

  return app;
}

export const app = createRelayerApp();
export default app;
