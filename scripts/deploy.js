const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying CertiChain with account:", deployer.address);

  const CertiChain = await hre.ethers.getContractFactory("CertiChain");
  const certiChain = await CertiChain.deploy();
  await certiChain.waitForDeployment();

  const address = await certiChain.getAddress();
  console.log("CertiChain deployed to:", address);
  console.log("Network:", hre.network.name);
  console.log("\nNext steps:");
  console.log("1. Verify on scan.botchain.ai (contract-verification page)");
  console.log("2. Call registerIssuer('Your Org Name') from the issuing wallet");
  console.log("3. Call issueCertificate(recipient, docHash, metadataURI)");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
