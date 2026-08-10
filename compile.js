const fs = require("fs");
const path = require("path");
const solc = require("solc");

const contractPath = path.join(__dirname, "contracts", "CertiChain.sol");
const source = fs.readFileSync(contractPath, "utf8");

const input = {
  language: "Solidity",
  sources: {
    "CertiChain.sol": { content: source },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

let hasError = false;
if (output.errors) {
  for (const err of output.errors) {
    if (err.severity === "error") {
      hasError = true;
      console.error(err.formattedMessage);
    } else {
      console.warn(err.formattedMessage);
    }
  }
}
if (hasError) process.exit(1);

const contract = output.contracts["CertiChain.sol"]["CertiChain"];

// Write in Hardhat artifact format so `hre.ethers.getContractFactory` works normally
const artifactDir = path.join(__dirname, "artifacts", "contracts", "CertiChain.sol");
fs.mkdirSync(artifactDir, { recursive: true });

const artifact = {
  _format: "hh-sol-artifact-1",
  contractName: "CertiChain",
  sourceName: "contracts/CertiChain.sol",
  abi: contract.abi,
  bytecode: "0x" + contract.evm.bytecode.object,
  deployedBytecode: "0x" + contract.evm.deployedBytecode.object,
  linkReferences: {},
  deployedLinkReferences: {},
};

fs.writeFileSync(path.join(artifactDir, "CertiChain.json"), JSON.stringify(artifact, null, 2));

// Also write a debug file Hardhat expects alongside artifacts (minimal, keeps toolbox happy)
fs.writeFileSync(
  path.join(artifactDir, "CertiChain.dbg.json"),
  JSON.stringify({ _format: "hh-sol-dbg-1", buildInfo: null }, null, 2)
);

console.log("Compiled successfully:", path.join(artifactDir, "CertiChain.json"));
console.log("Bytecode size:", (contract.evm.bytecode.object.length / 2), "bytes");
