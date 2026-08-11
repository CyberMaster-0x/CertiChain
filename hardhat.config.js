require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY =
  process.env.PRIVATE_KEY || "0x" + "11".repeat(32);

module.exports = {
  solidity: {
    version: "0.8.36",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  networks: {
    // BOT Chain Mainnet
    botchainMainnet: {
      url:
        process.env.BOTCHAIN_MAINNET_RPC ||
        "https://rpc.botchain.ai",
      chainId: 677,
      accounts: [PRIVATE_KEY],
    },

    // BOT Chain Testnet
    botchainTestnet: {
      url:
        process.env.BOTCHAIN_TESTNET_RPC ||
        "https://testnet-rpc.botchain.ai",
      chainId: Number(
        process.env.BOTCHAIN_TESTNET_CHAIN_ID || 6770
      ),
      accounts: [PRIVATE_KEY],
    },
  },

  etherscan: {
    apiKey: {
      botchainMainnet: "empty",
      botchainTestnet: "empty",
    },

    customChains: [
      {
        network: "botchainMainnet",
        chainId: 677,
        urls: {
          apiURL: "https://scan.botchain.ai/api",
          browserURL: "https://scan.botchain.ai",
        },
      },
    ],
  },
};