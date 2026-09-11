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

type AttestJobStatus = 'pending' | 'completed' | 'failed';

interface AttestJob {
  id: string;
  status: AttestJobStatus;
  message: string;
  error?: string;
  transactionHash?: string;
  positionId?: string;
}

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
  const jobs = new Map<string, AttestJob>();
  let jobSeq = 0;

  function createJob(message: string): AttestJob {
    jobSeq += 1;
    const job: AttestJob = {
      id: `job-${Date.now()}-${jobSeq}`,
      status: 'pending',
      message,
    };
    jobs.set(job.id, job);
    return job;
  }

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'crossvault-relayer',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/attest/jobs/:jobId', (req: Request, res: Response) => {
    const job = jobs.get(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: 'Unknown attestation job' });
    }
    return res.status(200).json(job);
  });

  /**
   * POST /attest/lock/:lockId
   * Starts lock attestation in the background and returns a job id.
   * Creditcoin can take several minutes to attest a Sepolia block; hosted
   * HTTP timeouts cannot wait on that, so the client polls /attest/jobs/:id.
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

    const requestedTxHash =
      typeof req.body?.transactionHash === 'string' ? req.body.transactionHash : null;
    const requestedBlock =
      req.body?.blockNumber !== undefined && req.body?.blockNumber !== null
        ? Number(req.body.blockNumber)
        : null;

    const job = createJob(`Looking up Sepolia lock #${lockId}`);
    console.log(`[Relayer] Attesting lock for lockId: ${lockId} job=${job.id}`);

    void runLockAttestation(job, lockId, lockIdBigInt, requestedTxHash, requestedBlock).catch(
      (err: any) => {
        const message = err?.message || 'Lock attestation failed';
        job.status = 'failed';
        job.error = message;
        job.message = message;
      }
    );

    return res.status(202).json({
      jobId: job.id,
      status: job.status,
      message: job.message,
    });
  });

  async function runLockAttestation(
    job: AttestJob,
    lockId: string,
    lockIdBigInt: bigint,
    requestedTxHash: string | null,
    requestedBlock: number | null
  ): Promise<void> {
    const fail = (error: string) => {
      job.status = 'failed';
      job.error = error;
      job.message = error;
    };

    const sepoliaDeployments = getDeployedSepolia();
    const creditcoinDeployments = getDeployedCreditcoin();
    const collateralLockAddress =
      sepoliaDeployments.collateralLock || sepoliaDeployments.CollateralLock;
    const crossVaultAddress =
      creditcoinDeployments.crossVault || creditcoinDeployments.CrossVault;

    if (!collateralLockAddress) {
      fail('CollateralLock address not found in deployed-sepolia.json');
      return;
    }
    if (!crossVaultAddress) {
      fail('CrossVault address not found in deployed-creditcoin.json');
      return;
    }

    job.message = `Finding Sepolia lock #${lockId}`;
    let blockNumber: number | null = requestedBlock;
    let transactionHash: string | null = requestedTxHash;

    try {
      const lockedEventTopic = collateralLockInterface.getEvent('Locked')!.topicHash;
      const lockIdTopic = ethers.zeroPadValue(ethers.toBeHex(lockIdBigInt), 32);

      if (requestedTxHash && !deps.getSepoliaLogs) {
        const sepoliaProvider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
        const receipt = await sepoliaProvider.getTransactionReceipt(requestedTxHash);
        if (receipt) {
          for (const log of receipt.logs) {
            if (log.address.toLowerCase() !== collateralLockAddress.toLowerCase()) continue;
            if (log.topics[0] !== lockedEventTopic) continue;
            if (log.topics[1] && log.topics[1].toLowerCase() === lockIdTopic.toLowerCase()) {
              blockNumber = receipt.blockNumber;
              transactionHash = receipt.hash;
              break;
            }
          }
        }
      }

      if (!transactionHash || !blockNumber) {
        let logs: ethers.Log[];
        if (deps.getSepoliaLogs) {
          logs = await deps.getSepoliaLogs({
            address: collateralLockAddress,
            topics: [lockedEventTopic, lockIdTopic],
          });
        } else {
          const sepoliaProvider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
          const latestBlock = await sepoliaProvider.getBlockNumber();
          const fromBlock = Math.max(0, latestBlock - 3000);
          logs = await sepoliaProvider.getLogs({
            address: collateralLockAddress,
            topics: [lockedEventTopic, lockIdTopic],
            fromBlock,
            toBlock: 'latest',
          });
        }
        if (logs && logs.length > 0) {
          blockNumber = logs[0].blockNumber;
          transactionHash = logs[0].transactionHash;
        }
      }
    } catch (err: any) {
      console.error(`[Relayer] Error fetching Sepolia logs for lockId ${lockId}:`, err);
      fail(`Failed to query Sepolia logs: ${err.message}`);
      return;
    }

    if (!transactionHash || !blockNumber) {
      console.warn(`[Relayer] Locked event not found on Sepolia for lockId ${lockId}`);
      fail(`Sepolia Locked event log not found for lockId ${lockId}`);
      return;
    }

    job.message = `Waiting for Sepolia block ${blockNumber} to be attested on Creditcoin. This can take several minutes.`;
    console.log(`[Relayer] Found Locked log at block ${blockNumber}, tx ${transactionHash}`);

    let proof: TxProofPayload;
    try {
      const fetchProofFn = deps.fetchProof || fetchSepoliaProof;
      proof = await fetchProofFn(transactionHash, blockNumber);
    } catch (err: any) {
      console.error(`[Relayer] Prover API error for tx ${transactionHash}:`, err);
      fail(`USC Prover API failed: ${err.message || 'Unknown error'}`);
      return;
    }

    job.message = `Submitting openPosition(${lockId}) on Creditcoin`;
    try {
      if (deps.submitOpenPosition) {
        const result = await deps.submitOpenPosition(crossVaultAddress, lockIdBigInt, proof);
        job.status = 'completed';
        job.transactionHash = result.hash;
        job.positionId = result.positionId;
        job.message = `Position #${result.positionId} opened`;
        return;
      }

      if (!CC3_PRIVATE_KEY) {
        fail('CC3_PRIVATE_KEY is not configured in environment');
        return;
      }

      const cc3Provider = new ethers.JsonRpcProvider(CC3_TESTNET_RPC_URL);
      const signer = new ethers.Wallet(CC3_PRIVATE_KEY, cc3Provider);
      const crossVault = new ethers.Contract(crossVaultAddress, CROSS_VAULT_ABI, signer);

      console.log(`[Relayer] Submitting openPosition(${lockId}) to CrossVault at ${crossVaultAddress}...`);
      const tx = await crossVault.openPosition(lockIdBigInt, proof, { gasPrice: 2000000000n });
      console.log(`[Relayer] Transaction broadcast: ${tx.hash}. Waiting for confirmation...`);
      const receipt = await tx.wait();

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

      job.status = 'completed';
      job.transactionHash = receipt.hash;
      job.positionId = positionId || 'unknown';
      job.message = `Position #${job.positionId} opened`;
      console.log(`[Relayer] Successfully opened position #${positionId} in tx ${receipt.hash}`);
    } catch (err: any) {
      const decodedReason = decodeRevertReason(err, crossVaultInterface);
      console.error(`[Relayer] openPosition reverted: ${decodedReason}`, err);
      fail(decodedReason);
    }
  }

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
        const fromBlock = Math.max(0, latestBlock - 3000);

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
