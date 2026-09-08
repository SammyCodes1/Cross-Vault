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

    it('falls back to error message if no custom error data', () => {
      const simulatedError = new Error('execution reverted: custom revert string');
      const decoded = decodeRevertReason(simulatedError, crossVaultInterface);
      assert.ok(decoded.includes('execution reverted'));
    });
  });

  describe('Endpoint Error & Success Handling', () => {
    it('POST /attest/lock/:lockId returns 404 when log does not exist on Sepolia', async () => {
      const testApp = createRelayerApp({
        getSepoliaLogs: async () => [],
      });
      const res = await request(testApp).post('/attest/lock/1');
      assert.strictEqual(res.status, 404);
      assert.ok(res.body.error.includes('Sepolia Locked event log not found'));
    });

    it('POST /attest/lock/:lockId returns 502 when prover API fails', async () => {
      const testApp = createRelayerApp({
        getSepoliaLogs: async () => [dummyLog],
        fetchProof: async () => {
          throw new Error('Prover timeout or network error');
        },
      });
      const res = await request(testApp).post('/attest/lock/1');
      assert.strictEqual(res.status, 502);
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
      const res = await request(testApp).post('/attest/lock/1');
      assert.strictEqual(res.status, 409);
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
      const res = await request(testApp).post('/attest/lock/1');
      assert.strictEqual(res.status, 409);
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
      const res = await request(testApp).post('/attest/lock/1');
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
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
  });
});
