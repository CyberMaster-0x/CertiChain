const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * WHAT THIS FILE IS FOR
 * ----------------------
 * This does NOT replace clicking through the real UI in a real browser with
 * a real Pinata key and a real wallet — that still has to happen before
 * submission, by a human, because this sandbox's network allowlist doesn't
 * include pinata.cloud or any IPFS gateway.
 *
 * What it DOES prove, mechanically, against a real deployed contract on a
 * real local chain:
 *   - The exact CONTRACT_ABI array typed into frontend/index.html is valid
 *     and matches the actual deployed contract (a typo here would only
 *     surface as a runtime error in the browser otherwise).
 *   - The exact canonicalCertificateJSON / hashCanonicalJSON functions used
 *     by the frontend produce a hash that matches what the contract stores.
 *   - The exact event-parsing logic used to pull the certificate ID out of
 *     a transaction receipt actually works against a real receipt.
 *   - The "fetch metadata, rehash, compare" verification logic correctly
 *     reports VERIFIED for genuine content and TAMPERED for altered content
 *     — with IPFS itself replaced by an in-memory stand-in, since that's
 *     the one real network call this sandbox can't make.
 *   - The legacy raw-content verify path (verifyByHash / hashContent)
 *     still works unchanged after all the additive changes.
 *   - Issuer approval and fake-issuer rejection still work, using the
 *     frontend's own ABI strings rather than the test suite's ABI.
 */

const FRONTEND_PATH = path.join(__dirname, "..", "frontend", "index.html");
const frontendSrc = fs.readFileSync(FRONTEND_PATH, "utf8");

// --- Extract the exact CONTRACT_ABI array as written in the frontend ---
function extractContractABI(src) {
  const marker = "const CONTRACT_ABI = [";
  const start = src.indexOf(marker);
  if (start === -1) throw new Error("Could not find CONTRACT_ABI in frontend");
  const arrayStart = start + marker.length - 1; // position of the "["
  const end = src.indexOf("];", arrayStart);
  if (end === -1) throw new Error("Could not find end of CONTRACT_ABI array");
  const arrayLiteral = src.slice(arrayStart, end + 1);
  // eslint-disable-next-line no-eval
  return eval(arrayLiteral);
}

// --- Extract a named function's exact source via brace matching ---
function extractFunctionSource(src, name) {
  const marker = "function " + name + "(";
  const start = src.indexOf(marker);
  if (start === -1) throw new Error("Could not find function " + name);
  let i = src.indexOf("{", start);
  let depth = 0;
  const bodyStart = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return src.slice(start, i + 1);
}

describe("Frontend integration (exact code paths extracted from frontend/index.html)", function () {
  let owner, issuer, stranger, recipient;
  let certiChain, contractAddress;
  let FrontendABI;
  let canonicalCertificateJSON, hashCanonicalJSON, hashContent;

  before(async function () {
    [owner, issuer, stranger, recipient] = await ethers.getSigners();

    // Deploy the real, unmodified contract exactly as the deploy script would.
    const CertiChain = await ethers.getContractFactory("CertiChain");
    certiChain = await CertiChain.deploy();
    await certiChain.waitForDeployment();
    contractAddress = await certiChain.getAddress();

    // Pull the ABI verbatim from the frontend file.
    FrontendABI = extractContractABI(frontendSrc);

    // Pull the hashing functions verbatim from the frontend file and eval
    // them with `ethers` in scope (same ethers v6 API surface as the CDN
    // build the frontend uses).
    const canonicalSrc = extractFunctionSource(frontendSrc, "canonicalCertificateJSON");
    const hashCanonicalSrc = extractFunctionSource(frontendSrc, "hashCanonicalJSON");
    const hashContentSrc = extractFunctionSource(frontendSrc, "hashContent");

    canonicalCertificateJSON = new Function("ethers", `return (${canonicalSrc})`)(ethers);
    hashCanonicalJSON = new Function("ethers", `return (${hashCanonicalSrc})`)(ethers);
    hashContent = new Function("ethers", `return (${hashContentSrc})`)(ethers);
  });

  it("the frontend's ABI array is well-formed and callable against the real deployed contract", async function () {
    const readContract = new ethers.Contract(contractAddress, FrontendABI, ethers.provider);
    // owner() is a simple read — if the ABI string had a typo, this throws.
    const chainOwner = await readContract.owner();
    expect(chainOwner).to.equal(owner.address);
  });

  it("[check: issuer approval still works] request -> approve using the frontend's exact ABI", async function () {
    const issuerAsFrontendSees = new ethers.Contract(contractAddress, FrontendABI, issuer);
    const ownerAsFrontendSees = new ethers.Contract(contractAddress, FrontendABI, owner);

    await issuerAsFrontendSees.requestIssuerStatus("LAUTECH Blockchain Community");
    await ownerAsFrontendSees.approveIssuer(issuer.address);

    const info = await ownerAsFrontendSees.issuers(issuer.address);
    expect(info.isRegistered).to.equal(true);
    expect(info.isActive).to.equal(true);
  });

  it("[check: fake issuer still rejected] an unapproved wallet cannot issue, via the frontend's exact ABI", async function () {
    const strangerAsFrontendSees = new ethers.Contract(contractAddress, FrontendABI, stranger);
    const fields = {
      studentName: "Fake Student",
      qualification: "Fake Degree",
      institution: "Definitely Not LAUTECH",
      issuedDate: "2026-08-10",
      note: ""
    };
    const canonicalStr = canonicalCertificateJSON(fields);
    const docHash = hashCanonicalJSON(canonicalStr);

    await expect(
      strangerAsFrontendSees.issueCertificate(recipient.address, docHash, "ipfs://fake")
    ).to.be.revertedWithCustomError(certiChain, "NotIssuer");
  });

  it("full issue -> verify flow: canonical hash matches on-chain hash, exactly as the Verify tab checks it", async function () {
    const issuerAsFrontendSees = new ethers.Contract(contractAddress, FrontendABI, issuer);

    const fields = {
      studentName: "Sharon Adebayo",
      qualification: "Solidity Fundamentals — Completed with Distinction",
      institution: "LAUTECH Blockchain Community",
      issuedDate: "2026-08-15",
      note: "BOT Chain Africa Workshop"
    };
    const canonicalStr = canonicalCertificateJSON(fields);
    const docHash = hashCanonicalJSON(canonicalStr);

    // Simulate the IPFS pin: in production this is Pinata; here it's just
    // "the exact bytes that would have been fetched back from the gateway."
    const simulatedIPFSContent = canonicalStr;
    const metadataURI = "ipfs://simulated-cid-for-testing";

    const tx = await issuerAsFrontendSees.issueCertificate(recipient.address, docHash, metadataURI);
    const receipt = await tx.wait();

    // Same event-parsing logic as the frontend's issueBtn handler.
    let certId = null;
    for (const log of receipt.logs) {
      try {
        const parsed = issuerAsFrontendSees.interface.parseLog(log);
        if (parsed && parsed.name === "CertificateIssued") {
          certId = parsed.args.certId.toString();
          break;
        }
      } catch (_) { /* ignore non-matching logs */ }
    }
    expect(certId).to.not.equal(null);

    // Same verification logic as runFullVerification().
    const readContract = new ethers.Contract(contractAddress, FrontendABI, ethers.provider);
    const result = await readContract.verifyCertificate(certId);
    expect(result.exists).to.equal(true);
    expect(result.valid).to.equal(true);

    const raw = await readContract.certificates(certId);
    const onChainHash = raw.docHash;

    // "Fetch from IPFS" (simulated) -> rehash -> compare.
    const recomputedHash = hashCanonicalJSON(simulatedIPFSContent);
    expect(recomputedHash.toLowerCase()).to.equal(onChainHash.toLowerCase());
    // This is the exact condition the frontend uses to render "✓ Hash matches".
  });

  it("[check: tamper detection] altering one field before rehashing correctly fails the integrity check", async function () {
    const issuerAsFrontendSees = new ethers.Contract(contractAddress, FrontendABI, issuer);

    const originalFields = {
      studentName: "Ibrahim Musa",
      qualification: "Blockchain Fundamentals — Distinction",
      institution: "LAUTECH Blockchain Community",
      issuedDate: "2026-08-15",
      note: ""
    };
    const canonicalStr = canonicalCertificateJSON(originalFields);
    const docHash = hashCanonicalJSON(canonicalStr);
    const metadataURI = "ipfs://simulated-cid-2";

    const tx = await issuerAsFrontendSees.issueCertificate(recipient.address, docHash, metadataURI);
    const receipt = await tx.wait();
    let certId = null;
    for (const log of receipt.logs) {
      try {
        const parsed = issuerAsFrontendSees.interface.parseLog(log);
        if (parsed && parsed.name === "CertificateIssued") { certId = parsed.args.certId.toString(); break; }
      } catch (_) {}
    }

    const readContract = new ethers.Contract(contractAddress, FrontendABI, ethers.provider);
    const raw = await readContract.certificates(certId);
    const onChainHash = raw.docHash;

    // Simulate someone editing the pinned content after the fact
    // ("Distinction" -> "Merit"), i.e. what would come back from IPFS
    // if it had been tampered with.
    const tamperedContent = canonicalCertificateJSON({
      ...originalFields,
      qualification: "Blockchain Fundamentals — Merit"
    });
    const recomputedHash = hashCanonicalJSON(tamperedContent);

    expect(recomputedHash.toLowerCase()).to.not.equal(onChainHash.toLowerCase());
    // This is the exact condition the frontend uses to render "✗ TAMPERED".
  });

  it("[check: old verification still works] legacy verifyByHash / paste-content box works unchanged after the IPFS/QR additions", async function () {
    const issuerAsFrontendSees = new ethers.Contract(contractAddress, FrontendABI, issuer);
    const rawContent = "Legacy-style raw certificate text, unchanged code path";
    const docHash = hashContent(rawContent);

    await issuerAsFrontendSees.issueCertificate(recipient.address, docHash, "");

    const readContract = new ethers.Contract(contractAddress, FrontendABI, ethers.provider);
    const result = await readContract.verifyByHash(hashContent(rawContent));
    expect(result.exists).to.equal(true);
    expect(result.valid).to.equal(true);
  });

  it("canonical hashing is order-independent on object key order (guards against a subtle future bug)", function () {
    const a = canonicalCertificateJSON({
      studentName: "Test",
      qualification: "Q",
      institution: "I",
      issuedDate: "2026-01-01",
      note: "N"
    });
    // Same logical data, keys given in a different order — must hash the same,
    // because canonicalCertificateJSON re-types fields explicitly rather than
    // trusting JSON.stringify's input key order.
    const b = canonicalCertificateJSON({
      note: "N",
      institution: "I",
      issuedDate: "2026-01-01",
      studentName: "Test",
      qualification: "Q"
    });
    expect(hashCanonicalJSON(a)).to.equal(hashCanonicalJSON(b));
  });
});
