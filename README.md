# CrossVault

CrossVault is a cross-chain vault infrastructure connecting **Ethereum Sepolia** and **Creditcoin 3 (CC3) Testnet** with Universal Smart Contract (USC) prover integration.

## Repository Architecture

This repository is organized as a monorepo featuring four core packages:

```text
crossvault/
├── contracts-sepolia/       # Foundry smart contracts for Ethereum Sepolia
├── contracts-creditcoin/    # Foundry smart contracts for Creditcoin 3 (CC3) Testnet
├── relayer/                 # Node.js + TypeScript + Express relayer service
├── frontend/                # Vite + React + TypeScript + ethers.js v6 web interface
├── package.json             # Root npm workspaces configuration (relayer & frontend)
├── .env.example             # Template for required environment variables
├── .gitignore               # Root gitignore rules
└── README.md                # Monorepo documentation
```

### Packages Overview

| Package | Stack | Purpose |
| :--- | :--- | :--- |
| `contracts-sepolia` | Foundry, Solidity, OpenZeppelin Contracts | Source/Destination contracts deployed to Ethereum Sepolia |
| `contracts-creditcoin` | Foundry, Solidity, OpenZeppelin Contracts | Contracts deployed to Creditcoin 3 (CC3) Testnet |
| `relayer` | Node.js, TypeScript, Express, ethers.js | Off-chain service monitoring events and coordinating cross-chain relaying |
| `frontend` | Vite, React, TypeScript, ethers.js v6 | Web interface for interacting with CrossVault |

---

## Prerequisites

- **Node.js**: `>= 20.x`
- **npm**: `>= 10.x`
- **Foundry / Forge**: `>= 1.0` (`forge --version`)
- **Git**: Configured for submodule support

---

## Getting Started

### 1. Clone & Initialize Submodules

If cloning the repository fresh:

```bash
git clone --recurse-submodules <repo-url> crossvault
cd crossvault
```

Or initialize submodules if already cloned:

```bash
git submodule update --init --recursive
```

### 2. Environment Variables

Copy the example environment configuration:

```bash
cp .env.example .env
```

Configure the following variables in `.env`:

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `SEPOLIA_RPC_URL` | Ethereum Sepolia JSON-RPC URL | e.g., Alchemy / Infura endpoint |
| `SEPOLIA_PRIVATE_KEY` | Private key for Sepolia transactions | `0x...` |
| `CC3_TESTNET_RPC_URL` | Creditcoin 3 Testnet JSON-RPC URL | `https://rpc.cc3-testnet.creditcoin.network` |
| `CC3_TESTNET_CHAIN_ID` | Creditcoin 3 Testnet Chain ID | `102031` |
| `CC3_PRIVATE_KEY` | Private key for Creditcoin 3 transactions | `0x...` |
| `USC_PROVER_API_URL` | Universal Smart Contract Prover API | `https://prover.cc3-testnet.creditcoin.network` |

### 3. Install Workspace Dependencies

Install dependencies for the `relayer` and `frontend` npm workspaces:

```bash
npm install
```

### 4. Build Smart Contracts

Compile the contracts in both Foundry packages:

```bash
# Compile Sepolia contracts
cd contracts-sepolia
forge build
cd ..

# Compile Creditcoin contracts
cd contracts-creditcoin
forge build
cd ..
```

Or run contract test suites:

```bash
npm run test:contracts-sepolia
npm run test:contracts-creditcoin
```

### 5. Running Services

#### Relayer (Express + TypeScript)

```bash
# Development mode with hot-reload
npm run dev:relayer

# Production build
npm run build:relayer
npm run start --workspace=relayer
```

#### Frontend (Vite + React + TS)

```bash
# Start Vite development server
npm run dev:frontend

# Production build
npm run build:frontend
```

---

## Tooling & Dependency Remappings

Both `contracts-sepolia` and `contracts-creditcoin` include OpenZeppelin Contracts and `forge-std`. Standard import remappings are configured in each folder's `remappings.txt`:

```text
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
forge-std/=lib/forge-std/src/
```

This ensures `@openzeppelin/contracts/...` imports resolve seamlessly across Forge and IDE tooling.
