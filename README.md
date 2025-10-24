# WalletConnect Waku Implementation

This project demonstrates a WalletConnect-like protocol implementation using Waku network for decentralized communication.

## Project Structure

- `shared/` - Shared SDK with common functionality
- `dapp/` - DApp implementation
- `wallet/` - Wallet implementation

## Setup

1. Install dependencies for all projects:
```bash
# Install all dependencies
npm run install-all

# Install SDK dependencies
cd shared
npm install
npm run build

# Install DApp dependencies
cd ../dapp
npm install

# Install Wallet dependencies
cd ../wallet
npm install

2. Build all projects
npm run build-all
