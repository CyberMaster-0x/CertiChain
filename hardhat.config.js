require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x" + "11".repeat(32); // dummy for local-only use

module.exports = {
  // NOTE: this sandbox's network egress blocks binaries.soliditylang.org,
  // which is where Hardhat normally auto-downloads the solc compiler from.
  // We compile via the npm `solc` package instead (see compile.js) and
  // write the artifact by hand, so `solidity:` config here is mostly
  // informational — on a normal machine with open internet, this same
  // config works with plain `npx hardhat compile`.
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // BOT Chain Mainnet 
    botchainMainnet: {
      url: process.env.BOTCHAIN_MAINNET_RPC || "https://rpc.botchain.ai", 
      chainId: 677,
      accounts: [PRIVATE_KEY],
    },
    // BOT Chain Testnet — TODO: fill in chainId + RPC from faucet.botchain.ai/basic
    // (connect BO Wallet there, it'll show you the "add network" details).
    botchainTestnet: {
      url: process.env.BOTCHAIN_TESTNET_RPC || "https://testnet-rpc.botchain.ai",
      chainId: Number(process.env.BOTCHAIN_TESTNET_CHAIN_ID || 6770), // PLACEHOLDER — replace with real value
      accounts: [PRIVATE_KEY],
    },
  },
  etherscan: {
    // BOT Chain's explorer (scan.botchain.ai) is Blockscout-based, not Etherscan.
    // Use `npx hardhat verify` only if they expose an Etherscan-compatible API,
    // otherwise verify manually via the scan.botchain.ai "Verify Contract" page
    // (see https://scan.botchain.ai/contract-verification).
    apiKey: {
      botchainTestnet: "not-needed-for-blockscout",
      botchainMainnet: "not-needed-for-blockscout",
    },
  },
};
