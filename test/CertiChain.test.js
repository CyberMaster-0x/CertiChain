const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("CertiChain", function () {
  let certiChain;
  let owner, issuer, otherIssuer, recipient, stranger;

  beforeEach(async function () {
    [owner, issuer, otherIssuer, recipient, stranger] = await ethers.getSigners();
    const CertiChain = await ethers.getContractFactory("CertiChain");
    certiChain = await CertiChain.deploy();
    await certiChain.waitForDeployment();
  });

  function hashOf(str) {
    return ethers.keccak256(ethers.toUtf8Bytes(str));
  }

  describe("Issuer registration (request -> owner approval)", function () {
    it("lets anyone submit a request, but does not grant issuing rights yet", async function () {
      await expect(certiChain.connect(issuer).requestIssuerStatus("LAUTECH Blockchain Community"))
        .to.emit(certiChain, "IssuerRequested")
        .withArgs(issuer.address, "LAUTECH Blockchain Community");

      const info = await certiChain.issuers(issuer.address);
      expect(info.isPending).to.equal(true);
      expect(info.isRegistered).to.equal(false); // key check: request alone isn't enough
      expect(info.isActive).to.equal(false);
    });

    it("reverts on a duplicate pending request", async function () {
      await certiChain.connect(issuer).requestIssuerStatus("Org A");
      await expect(
        certiChain.connect(issuer).requestIssuerStatus("Org A again")
      ).to.be.revertedWithCustomError(certiChain, "AlreadyPending");
    });

    it("owner can approve a pending request, which is what actually grants issuing rights", async function () {
      await certiChain.connect(issuer).requestIssuerStatus("Org A");
      await expect(certiChain.connect(owner).approveIssuer(issuer.address))
        .to.emit(certiChain, "IssuerApproved")
        .withArgs(issuer.address, "Org A");

      const info = await certiChain.issuers(issuer.address);
      expect(info.isPending).to.equal(false);
      expect(info.isRegistered).to.equal(true);
      expect(info.isActive).to.equal(true);
    });

    it("prevents non-owners from approving issuers", async function () {
      await certiChain.connect(issuer).requestIssuerStatus("Org A");
      await expect(
        certiChain.connect(stranger).approveIssuer(issuer.address)
      ).to.be.revertedWithCustomError(certiChain, "NotOwner");
    });

    it("rejects approval when there is no pending request (blocks a random address grab)", async function () {
      await expect(
        certiChain.connect(owner).approveIssuer(stranger.address)
      ).to.be.revertedWithCustomError(certiChain, "NoPendingRequest");
    });

    it("owner can reject a pending request instead of approving it", async function () {
      await certiChain.connect(issuer).requestIssuerStatus("Suspicious Org");
      await expect(certiChain.connect(owner).rejectIssuer(issuer.address))
        .to.emit(certiChain, "IssuerRejected")
        .withArgs(issuer.address);

      const info = await certiChain.issuers(issuer.address);
      expect(info.isPending).to.equal(false);
      expect(info.isRegistered).to.equal(false);
    });

    it("lets the owner deactivate a fraudulent issuer after approval", async function () {
      await certiChain.connect(issuer).requestIssuerStatus("Org A");
      await certiChain.connect(owner).approveIssuer(issuer.address);

      await expect(certiChain.connect(owner).setIssuerActive(issuer.address, false))
        .to.emit(certiChain, "IssuerStatusChanged")
        .withArgs(issuer.address, false);

      const info = await certiChain.issuers(issuer.address);
      expect(info.isActive).to.equal(false);
    });

    it("prevents non-owners from changing issuer status", async function () {
      await certiChain.connect(issuer).requestIssuerStatus("Org A");
      await certiChain.connect(owner).approveIssuer(issuer.address);
      await expect(
        certiChain.connect(stranger).setIssuerActive(issuer.address, false)
      ).to.be.revertedWithCustomError(certiChain, "NotOwner");
    });
  });

  describe("Certificate issuance", function () {
    beforeEach(async function () {
      await certiChain.connect(issuer).requestIssuerStatus("Org A");
      await certiChain.connect(owner).approveIssuer(issuer.address);
    });

    it("issues a certificate and stores correct data", async function () {
      const docHash = hashOf("Ibrahim - Blockchain Fundamentals - 2026-08-09");
      const tx = await certiChain
        .connect(issuer)
        .issueCertificate(recipient.address, docHash, "ipfs://cert-metadata-1");

      await expect(tx)
        .to.emit(certiChain, "CertificateIssued")
        .withArgs(1, issuer.address, recipient.address, docHash, "ipfs://cert-metadata-1");

      const result = await certiChain.verifyCertificate(1);
      expect(result.exists).to.equal(true);
      expect(result.valid).to.equal(true);
      expect(result.recipient).to.equal(recipient.address);
      expect(result.issuerName).to.equal("Org A");
    });

    it("rejects issuance from unregistered addresses", async function () {
      const docHash = hashOf("fake cert");
      await expect(
        certiChain.connect(stranger).issueCertificate(recipient.address, docHash, "")
      ).to.be.revertedWithCustomError(certiChain, "NotIssuer");
    });

    it("rejects issuance from a deactivated issuer", async function () {
      await certiChain.connect(owner).setIssuerActive(issuer.address, false);
      const docHash = hashOf("cert after ban");
      await expect(
        certiChain.connect(issuer).issueCertificate(recipient.address, docHash, "")
      ).to.be.revertedWithCustomError(certiChain, "IssuerInactive");
    });

    it("prevents the exact same document hash from being issued twice", async function () {
      const docHash = hashOf("duplicate cert content");
      await certiChain.connect(issuer).issueCertificate(recipient.address, docHash, "");
      await expect(
        certiChain.connect(issuer).issueCertificate(recipient.address, docHash, "")
      ).to.be.revertedWithCustomError(certiChain, "DuplicateDocument");
    });

    it("tracks certificates per recipient", async function () {
      const h1 = hashOf("cert 1");
      const h2 = hashOf("cert 2");
      await certiChain.connect(issuer).issueCertificate(recipient.address, h1, "");
      await certiChain.connect(issuer).issueCertificate(recipient.address, h2, "");

      const ids = await certiChain.getCertificatesOf(recipient.address);
      expect(ids.map((n) => Number(n))).to.deep.equal([1, 2]);
    });
  });

  describe("Verification by hash (the tamper-check demo)", function () {
    beforeEach(async function () {
      await certiChain.connect(issuer).requestIssuerStatus("Org A");
      await certiChain.connect(owner).approveIssuer(issuer.address);
    });

    it("verifies a genuine, unmodified document", async function () {
      const originalContent = "Sharon - Solidity Bootcamp - Grade A - 2026-08-09";
      const docHash = hashOf(originalContent);
      await certiChain.connect(issuer).issueCertificate(recipient.address, docHash, "");

      const result = await certiChain.verifyByHash(hashOf(originalContent));
      expect(result.exists).to.equal(true);
      expect(result.valid).to.equal(true);
    });

    it("fails verification for a tampered document (different hash)", async function () {
      const originalContent = "Sharon - Solidity Bootcamp - Grade A - 2026-08-09";
      const tamperedContent = "Sharon - Solidity Bootcamp - Grade A+ - 2026-08-09"; // grade changed
      const docHash = hashOf(originalContent);
      await certiChain.connect(issuer).issueCertificate(recipient.address, docHash, "");

      const result = await certiChain.verifyByHash(hashOf(tamperedContent));
      expect(result.exists).to.equal(false);
    });
  });

  describe("Revocation", function () {
    let certId, docHash;

    beforeEach(async function () {
      await certiChain.connect(issuer).requestIssuerStatus("Org A");
      await certiChain.connect(owner).approveIssuer(issuer.address);
      docHash = hashOf("revocable cert");
      await certiChain.connect(issuer).issueCertificate(recipient.address, docHash, "");
      certId = 1;
    });

    it("lets the issuer revoke their own certificate", async function () {
      await expect(certiChain.connect(issuer).revokeCertificate(certId)).to.emit(
        certiChain,
        "CertificateRevoked"
      );

      const result = await certiChain.verifyCertificate(certId);
      expect(result.revoked).to.equal(true);
      expect(result.valid).to.equal(false); // revoked => not valid, even though it "exists"
    });

    it("prevents a different issuer from revoking someone else's certificate", async function () {
      await certiChain.connect(otherIssuer).requestIssuerStatus("Org B");
      await certiChain.connect(owner).approveIssuer(otherIssuer.address);
      await expect(
        certiChain.connect(otherIssuer).revokeCertificate(certId)
      ).to.be.revertedWithCustomError(certiChain, "NotCertIssuer");
    });

    it("prevents double revocation", async function () {
      await certiChain.connect(issuer).revokeCertificate(certId);
      await expect(certiChain.connect(issuer).revokeCertificate(certId)).to.be.revertedWithCustomError(
        certiChain,
        "AlreadyRevoked"
      );
    });

    it("returns exists=false for a certificate ID that was never issued", async function () {
      const result = await certiChain.verifyCertificate(9999);
      expect(result.exists).to.equal(false);
    });
  });
});
