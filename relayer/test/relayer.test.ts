import { describe, it } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { ethers } from 'ethers';
import { app, createRelayerApp } from '../src/server';
import { decodeRevertReason, crossVaultInterface } from '../src/contracts';
import { TxProofPayload } from '../src/prover';

const dummyProof: TxProofPayload = {
  height: 1000000n,
  encodedTx: '0x1234',
  merkleProof: {
    root: ethers.keccak256(ethers.toUtf8Bytes('root')),
    siblings: [],
  },
  continuityProof: {
    lowerEndpointDigest: ethers.ZeroHash,
    roots: [],
  },
};

const dummyLog = {
  blockNumber: 1000000,
  transactionHash: '0x' + '1'.repeat(64),
  address: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
  data: '0x',
  topics: [],
} as unknown as ethers.Log;

describe('Relayer Service Unit & API Tests', () => {
  it('GET /health returns 200 and status ok', async () => {
    const res = await request(app).get('/health');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.status, 'ok');
    assert.strictEqual(res.body.service, 'crossvault-relayer');
  });

  describe('Revert Reason Decoder', () => {
    it('decodes custom error LockAlreadyUsed correctly', () => {
      const errorData = crossVaultInterface.encodeErrorResult('LockAlreadyUsed', []);
      const simulatedError = { data: errorData };
      const decoded = decodeRevertReason(simulatedError, crossVaultInterface);
      assert.strictEqual(decoded, 'LockAlreadyUsed');
    });

    it('decodes custom error VerificationFailed correctly', () => {
      const errorData = crossVaultInterface.encodeErrorResult('VerificationFailed', []);
      const simulatedError = { info: { error: { data: errorData } } };
      const decoded = decodeRevertReason(simulatedError, crossVaultInterface);
      assert.strictEqual(decoded, 'VerificationFailed');
    });

    it('decodes custom error ProofAlreadyUsed correctly', () => {
      const errorData = crossVaultInterface.encodeErrorResult('ProofAlreadyUsed', []);
      const simulatedError = { error: { data: errorData } };
      const decoded = decodeRevertReason(simulatedError, crossVaultInterface);
      assert.strictEqual(decoded, 'ProofAlreadyUsed');
    });

    it('decodes custom error LockIdMismatch correctly', () => {
      const errorData = crossVaultInterface.encodeErrorResult('LockIdMismatch', []);
      const simulatedError = { data: errorData };
      const decoded = decodeRevertReason(simulatedError, crossVaultInterface);
      assert.strictEqual(decoded, 'LockIdMismatch');
    });

    it('decodes custom error PriceNotSet correctly', () => {
      const errorData = crossVaultInterface.encodeErrorResult('PriceNotSet', []);
      const simulatedError = { data: errorData };
      const decoded = decodeRevertReason(simulatedError, crossVaultInterface);
      assert.strictEqual(decoded, 'PriceNotSet');
    });

    it('decodes custom error NotLiquidatable correctly', () => {
      const errorData = crossVaultInterface.encodeErrorResult('NotLiquidatable', []);
      const simulatedError = { data: errorData };
      const decoded = decodeRevertReason(simulatedError, crossVaultInterface);
      assert.strictEqual(decoded, 'NotLiquidatable');
    });

    it('decodes custom error WrongContract correctly', () => {
      const errorData = crossVaultInterface.encodeErrorResult('WrongContract', []);
      const simulatedError = { data: errorData };
      const decoded = decodeRevertReason(simulatedError, crossVaultInterface);
      assert.strictEqual(decoded, 'WrongContract');
    });

    it('decodes custom error WrongFeedId correctly', () => {
      const errorData = crossVaultInterface.encodeErrorResult('WrongFeedId', []);
      const simulatedError = { data: errorData };
      const decoded = decodeRevertReason(simulatedError, crossVaultInterface);
      assert.strictEqual(decoded, 'WrongFeedId');
    });

    it('falls back to error message if no custom error data', () => {
      const simulatedError = new Error('execution reverted: custom revert string');
      const decoded = decodeRevertReason(simulatedError, crossVaultInterface);
      assert.ok(decoded.includes('execution reverted'));
    });
  });

  async function awaitLockJob(app: any, lockId: string) {
  const start = await request(app).post(`/attest/lock/${lockId}`);
  if (start.status !== 202) return start;
  const jobId = start.body.jobId;
  for (let i = 0; i < 40; i++) {
    const st = await request(app).get(`/attest/jobs/${jobId}`);
    if (st.body.status === 'completed' || st.body.status === 'failed') return st;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('attestation job did not settle');
}

describe('Endpoint Error & Success Handling', () => {
    it('POST /attest/lock/:lockId returns 404 when log does not exist on Sepolia', async () => {
      const testApp = createRelayerApp({
        getSepoliaLogs: async () => [],
      });
      const res = await awaitLockJob(testApp, '1');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'failed');
      assert.ok(res.body.error.includes('Sepolia Locked event log not found'));
    });

    it('POST /attest/lock/:lockId returns 502 when prover API fails', async () => {
      const testApp = createRelayerApp({
        getSepoliaLogs: async () => [dummyLog],
        fetchProof: async () => {
          throw new Error('Prover timeout or network error');
        },
      });
      const res = await awaitLockJob(testApp, '1');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'failed');
      assert.ok(res.body.error.includes('USC Prover API failed: Prover timeout or network error'));
    });

    it('POST /attest/lock/:lockId returns 409 with decoded revert reason when openPosition reverts', async () => {
      const errorData = crossVaultInterface.encodeErrorResult('LockAlreadyUsed', []);
      const testApp = createRelayerApp({
        getSepoliaLogs: async () => [dummyLog],
        fetchProof: async () => dummyProof,
        submitOpenPosition: async () => {
          const err: any = new Error('execution reverted');
          err.data = errorData;
          throw err;
        },
      });
      const res = await awaitLockJob(testApp, '1');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'failed');
      assert.strictEqual(res.body.error, 'LockAlreadyUsed');
    });

    it('POST /attest/lock/:lockId returns 409 with VerificationFailed when cryptographic proof fails', async () => {
      const errorData = crossVaultInterface.encodeErrorResult('VerificationFailed', []);
      const testApp = createRelayerApp({
        getSepoliaLogs: async () => [dummyLog],
        fetchProof: async () => dummyProof,
        submitOpenPosition: async () => {
          const err: any = new Error('execution reverted');
          err.data = errorData;
          throw err;
        },
      });
      const res = await awaitLockJob(testApp, '1');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'failed');
      assert.strictEqual(res.body.error, 'VerificationFailed');
    });

    it('POST /attest/lock/:lockId returns 200 with tx hash and positionId on success', async () => {
      const testApp = createRelayerApp({
        getSepoliaLogs: async () => [dummyLog],
        fetchProof: async () => dummyProof,
        submitOpenPosition: async () => ({
          hash: '0x' + '2'.repeat(64),
          positionId: '1',
        }),
      });
      const res = await awaitLockJob(testApp, '1');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.status, 'completed');
      assert.strictEqual(res.body.transactionHash, '0x' + '2'.repeat(64));
      assert.strictEqual(res.body.positionId, '1');
    });

    it('POST /attest/price returns 404 when log does not exist on Sepolia', async () => {
      const testApp = createRelayerApp({
        getSepoliaLogs: async () => [],
      });
      const res = await request(testApp).post('/attest/price');
      assert.strictEqual(res.status, 404);
      assert.ok(res.body.error.includes('Sepolia PriceUpdated event log not found'));
    });

    it('POST /attest/price returns 502 when prover API fails', async () => {
      const testApp = createRelayerApp({
        getSepoliaLogs: async () => [dummyLog],
        fetchProof: async () => {
          throw new Error('Prover unavailable');
        },
      });
      const res = await request(testApp).post('/attest/price');
      assert.strictEqual(res.status, 502);
      assert.ok(res.body.error.includes('USC Prover API failed: Prover unavailable'));
    });

    it('POST /attest/price returns 409 when updatePrice reverts with ProofAlreadyUsed', async () => {
      const errorData = crossVaultInterface.encodeErrorResult('ProofAlreadyUsed', []);
      const testApp = createRelayerApp({
        getSepoliaLogs: async () => [dummyLog],
        fetchProof: async () => dummyProof,
        submitUpdatePrice: async () => {
          const err: any = new Error('execution reverted');
          err.data = errorData;
          throw err;
        },
      });
      const res = await request(testApp).post('/attest/price');
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error, 'ProofAlreadyUsed');
    });

    it('POST /attest/price returns 200 with tx hash on success', async () => {
      const testApp = createRelayerApp({
        getSepoliaLogs: async () => [dummyLog],
        fetchProof: async () => dummyProof,
        submitUpdatePrice: async () => ({
          hash: '0x' + '3'.repeat(64),
        }),
      });
      const res = await request(testApp).post('/attest/price');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.transactionHash, '0x' + '3'.repeat(64));
    });

    it('POST /attest/price/pyth returns 404 when log does not exist on Sepolia', async () => {
      const testApp = createRelayerApp({
        getSepoliaLogs: async () => [],
      });
      const res = await request(testApp).post('/attest/price/pyth');
      assert.strictEqual(res.status, 404);
      assert.ok(res.body.error.includes('Sepolia Pyth PriceFeedUpdate event log not found'));
    });

    it('POST /attest/price/pyth returns 502 when prover API fails', async () => {
      const testApp = createRelayerApp({
        getSepoliaLogs: async () => [dummyLog],
        fetchProof: async () => {
          throw new Error('Prover unavailable');
        },
      });
      const res = await request(testApp).post('/attest/price/pyth');
      assert.strictEqual(res.status, 502);
      assert.ok(res.body.error.includes('USC Prover API failed: Prover unavailable'));
    });

    it('POST /attest/price/pyth returns 409 when updatePriceFromPyth reverts with WrongFeedId', async () => {
      const errorData = crossVaultInterface.encodeErrorResult('WrongFeedId', []);
      const testApp = createRelayerApp({
        getSepoliaLogs: async () => [dummyLog],
        fetchProof: async () => dummyProof,
        submitUpdatePriceFromPyth: async () => {
          const err: any = new Error('execution reverted');
          err.data = errorData;
          throw err;
        },
      });
      const res = await request(testApp).post('/attest/price/pyth');
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error, 'WrongFeedId');
    });

    it('POST /attest/price/pyth returns 200 with tx hash and source: Pyth on success', async () => {
      const testApp = createRelayerApp({
        getSepoliaLogs: async () => [dummyLog],
        fetchProof: async () => dummyProof,
        submitUpdatePriceFromPyth: async () => ({
          hash: '0x' + '4'.repeat(64),
        }),
      });
      const res = await request(testApp).post('/attest/price/pyth');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.transactionHash, '0x' + '4'.repeat(64));
      assert.strictEqual(res.body.source, 'Pyth');
    });

    it('POST /attest/lock/:lockId returns 429 after the per-IP attest budget is spent', async () => {
      const testApp = createRelayerApp({
        getSepoliaLogs: async () => [dummyLog],
        fetchProof: async () => dummyProof,
        submitOpenPosition: async () => ({
          hash: '0x' + '2'.repeat(64),
          positionId: '1',
        }),
      });
      for (let i = 0; i < 8; i++) {
        const ok = await request(testApp).post('/attest/lock/1');
        assert.strictEqual(ok.status, 202);
      }
      const limited = await request(testApp).post('/attest/lock/1');
      assert.strictEqual(limited.status, 429);
      assert.ok(limited.body.error.includes('Rate limit exceeded'));
    });

    it('POST /attest/price/pyth ignores untrusted transactionHash in the request body', async () => {
      let fetchedTx = '';
      let fetchedBlock = 0;
      const testApp = createRelayerApp({
        getSepoliaLogs: async () => [dummyLog],
        fetchProof: async (txHash, blockHeight) => {
          fetchedTx = txHash;
          fetchedBlock = blockHeight;
          return dummyProof;
        },
        submitUpdatePriceFromPyth: async () => ({
          hash: '0x' + '5'.repeat(64),
        }),
      });
      const res = await request(testApp)
        .post('/attest/price/pyth')
        .send({ transactionHash: '0xabc123', blockNumber: 999999 });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.transactionHash, '0x' + '5'.repeat(64));
      assert.strictEqual(res.body.source, 'Pyth');
      assert.strictEqual(fetchedTx, dummyLog.transactionHash);
      assert.strictEqual(fetchedBlock, dummyLog.blockNumber);
    });
  });
});
