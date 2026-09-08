# CrossVault

CrossVault is an end-to-end cross-chain lending protocol connecting **Ethereum Sepolia** and **Creditcoin 3 (CC3) Testnet** powered by the **Attestcoin / Universal Smart Contract (USC)** BlockProver precompile.

Borrowers lock collateral (mWETH) on Sepolia, the off-chain relayer obtains cryptographic Merkle inclusion and block continuity proofs from the USC Prover, and Creditcoin's on-chain `CrossVault` contract verifies the proof via precompile `0x0000000000000000000000000000000000000FD2` to mint `tvUSD` debt tokens at a 150% collateralization ratio.

---

## Live Deployments & Addresses

### Ethereum Sepolia (Chain ID: `11155111`)
- **`MockCollateralToken` (mWETH)**: `0x208Af80035A2009Ec0373264623E417C2c26c6eB`
- **`CollateralLock`**: `0x819068a43Ec7f7367B025B7dF0FAbeAdf70F173f`
- **`MockPriceFeed`**: `0x5Eb309a76C6E993293CD756d938BBb35F3bFd35f`

### Creditcoin 3 Testnet (Chain ID: `102031` / `0x18E8F`)
- **`DebtToken` (tvUSD)**: `0xBDC3F5e9cc6af3b125A45d177E65C67154fa008c`
- **`CrossVault`**: `0xB88fc006A0cdE6a44963014c22abbC32bAe69739`
- **BlockProver Precompile**: `0x0000000000000000000000000000000000000FD2`

---

## Monorepo Architecture

```text
crossvault/
├── contracts-sepolia/       # Solidity smart contracts for Ethereum Sepolia (Foundry)
│   ├── src/MockCollateralToken.sol
│   ├── src/CollateralLock.sol
│   └── src/MockPriceFeed.sol
├── contracts-creditcoin/    # Solidity smart contracts for Creditcoin 3 (Foundry)
│   ├── src/DebtToken.sol
│   ├── src/CrossVault.sol
│   └── src/interfaces/IBlockProver.sol
├── relayer/                 # Express + TypeScript relayer & USC proof submission engine
│   ├── src/server.ts
│   ├── src/prover.ts
│   └── src/contracts.ts
├── frontend/                # Vite + React + TypeScript + ethers.js v6 web interface
│   ├── src/components/WalletConnect.tsx
│   ├── src/components/LockBorrowPanel.tsx
│   ├── src/components/PositionDashboard.tsx
│   └── src/components/PriceControl.tsx
├── deployed-sepolia.json    # Verified Sepolia deployment addresses
├── deployed-creditcoin.json # Verified Creditcoin 3 deployment addresses
├── ATTESTCOIN_INTERFACE.md  # On-chain BlockProver interface specification
└── README.md
```

---

## Protocol Flow

```text
[Sepolia]
 1. User locks mWETH in CollateralLock -> emits Locked(lockId, owner, amount)
 2. Relayer captures event log (txHash, blockHeight)

[USC Prover]
 3. Relayer calls USC Prover API (Chain Key 1 = Sepolia)
 4. Prover generates Merkle Inclusion Proof + Block Continuity Proof

[Creditcoin 3]
 5. Relayer submits proof to CrossVault.openPosition(lockId, proof)
 6. CrossVault invokes BlockProver precompile (0x...FD2) to verify authenticity
 7. CrossVault verifies decoded event data (emitter, lockId, owner, amount)
 8. CrossVault mints tvUSD to borrower at 150% collateral ratio
```

---

## Frontend Web Application

The frontend provides a complete user interface for the cross-chain lending protocol:
- **Wallet Connection & Network Switching**:
  - One-click network switcher between **Sepolia** (`11155111`) and **Creditcoin Testnet** (`102031` / `0x18E8F`).
  - Automatic `wallet_addEthereumChain` configuration for Creditcoin Testnet.
- **Lock & Borrow Panel**:
  - Deposit mWETH collateral on Sepolia.
  - Automatic testnet minting if user balance is 0.
  - Step-by-step progress tracking: `Locking` -> `Attesting` -> `Verifying on Creditcoin` -> `Position Opened`.
- **Position Dashboard**:
  - Real-time queries directly from `CrossVault` on Creditcoin 3.
  - Displays collateral (mWETH), debt (tvUSD), collateralization ratio %, and health status.
  - Highlights user's active positions.
- **Update Price Demo Control**:
  - Interactive for oracle owner to simulate market price movements.
  - Calls `MockPriceFeed.setPrice` on Sepolia followed by relayer attestation to CC3.
  - Quick presets: `$3,000` (Baseline), `$2,000` (Drop), `$1,600` (Triggers liquidation threshold `< 120%`).
- **Conditional Liquidation**:
  - "Liquidate" button appears **only** when `isLiquidatable(positionId)` is `true`.
  - Executes `CrossVault.liquidate(positionId)` on Creditcoin 3 by burning outstanding `tvUSD`.

---

## Quickstart

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env` and fill in RPC URLs and private keys:
```bash
cp .env.example .env
```

### 3. Run the Relayer
```bash
npm run build --workspace=relayer
npm run start --workspace=relayer
# Relayer listens on http://localhost:3001
```

### 4. Run the Frontend
```bash
npm run dev --workspace=frontend
# Or preview the production build:
npm run build --workspace=frontend
npm run preview --workspace=frontend
# Accessible at http://localhost:5173
```
