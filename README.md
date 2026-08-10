# CertiChain

Tamper-proof certificates for schools, training programs, and professional
credentials — built for the BOT Chain Africa Pioneer Builder Challenge.

An issuer (a school, bootcamp, or certifying body) registers on-chain, then
mints certificates bound to a `keccak256` hash of the certificate content.
Anyone — an employer, another school, a curious stranger — can verify a
certificate's authenticity and status without trusting a centralized
database, and without needing to trust the issuer's word after the fact:
change one character of the original document and the hash no longer
matches anything on-chain.

## What's in this repo

```
contracts/CertiChain.sol           the contract
test/CertiChain.test.js            19 tests: issuance, verification, revocation, access control
test/frontend-integration.test.js  7 tests: proves the frontend's actual ABI/hashing code works end-to-end
scripts/deploy.js                  deploy script
frontend/index.html                single-file demo UI (issue / verify / register / admin approve)
compile.js                         compiles via the npm `solc` package (see note below)
hardhat.config.js                  network config for BOT Chain testnet + mainnet
.gitignore                         keeps node_modules, .env, and build output out of the repo
```

## Why `compile.js` instead of `npx hardhat compile`

This was built in a sandboxed environment that blocks
`binaries.soliditylang.org`, which is where Hardhat normally
auto-downloads the Solidity compiler from. `compile.js` uses the `solc`
npm package instead (installed from the regular npm registry, so it's not
blocked) and writes the artifact by hand in Hardhat's expected format.

**On your own machine with normal internet access, you almost certainly
don't need this** — `npx hardhat compile` should just work. `compile.js`
is left in as a fallback / for anyone building from a similarly locked-down
CI environment. Either way, run tests with `--no-compile` so Hardhat uses
whichever artifact is already on disk instead of trying to download a
compiler:

```
npm run compile   # writes artifacts/contracts/CertiChain.sol/CertiChain.json
npm test          # runs the 15 tests against that artifact
```

## Security: before you push this to a public repo

- **Never commit `.env`.** It's already in `.gitignore`, but double-check
  before every push — a leaked `PRIVATE_KEY` means anyone can drain that
  wallet.
- **Never hardcode your Pinata JWT into `frontend/index.html`.** The app
  intentionally keeps it in the browser's local storage only, entered once
  per browser via the box on the page — not in a config variable in the
  source. If you ever paste a real key into the file to "make setup
  easier" and then commit it, revoke that key immediately from the Pinata
  dashboard and issue a new one. Treat it like a password, not a config
  value.
- If you're demoing on a shared/public machine, clear the Pinata field
  (or your browser's local storage for this page) afterward.

## What's been verified vs. what you still need to test yourself

I don't have network access to Pinata or any IPFS gateway from this build
environment, so I can't click through the real upload/fetch myself. What I
did instead: `test/frontend-integration.test.js` extracts the **exact**
`CONTRACT_ABI` array, `canonicalCertificateJSON`, `hashCanonicalJSON`, and
`hashContent` functions verbatim out of `frontend/index.html` (not
re-typed copies — the literal source text), and runs them against a real
deployed contract on a local chain, with an in-memory stand-in for the
IPFS fetch. `npm test` → 26/26 passing, confirms:

- The frontend's ABI strings are valid and match the real contract (a typo
  here would otherwise only surface as a runtime error in the browser).
- Issuer request → approval still works, called exactly as the frontend
  calls it.
- An unapproved wallet still gets rejected when trying to issue.
- The full issue → get real certificate ID from the event → verify →
  hash comparison path produces "hash matches" for genuine content.
- The same path produces "hash mismatch" for content someone edited after
  the fact — i.e. the tamper-detection logic is correct.
- The original "paste raw content" legacy verify box still works,
  unmodified, after everything else changed around it.
- The canonical hashing is provably independent of the order fields are
  supplied in (guards against a subtle bug where two logically-identical
  certificates hash differently).

**What this does NOT cover, and what you need to do yourself before Aug
13:** an actual Pinata upload, an actual IPFS gateway fetch, an actual QR
code scanned with a phone camera, and the actual MetaMask/BO Wallet
approval popups. Those all depend on real network calls and a real
browser, which this environment can't do. Run through the full demo
script below at least once, end to end, with your real Pinata key, before
you rely on it in front of judges.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- `PRIVATE_KEY` — the deployer wallet's private key (needs testnet BOT — see below)
- `BOTCHAIN_TESTNET_RPC` / `BOTCHAIN_TESTNET_CHAIN_ID` — **you need to fill these in yourself.**
  I confirmed BOT Chain **mainnet** is chain ID `677` via chainlist.org, but
  couldn't pull the exact testnet RPC/chain ID through search. Go to
  `https://faucet.botchain.ai/basic`, connect your wallet, and use its
  "add network" flow — it'll show you the exact values to paste in here.

## Get testnet funds

Visit `https://faucet.botchain.ai/basic`, connect the wallet you'll deploy
from, and claim test BOT.

## Deploy

```bash
npm run deploy:testnet
```

This prints the deployed contract address. **Copy it.**

## Verify the contract

BOT Chain's explorer (`scan.botchain.ai`) is Blockscout-based, not
Etherscan, so `npx hardhat verify` may not work out of the box. Go to
`https://scan.botchain.ai/contract-verification`, paste in `contracts/CertiChain.sol`,
select compiler version `0.8.24` with the optimizer on (200 runs), and
verify manually. This step matters for judging — the challenge criteria
explicitly include on-chain deployment *and verification*.

## Wire up the frontend

Open `frontend/index.html`, find this line near the top of the `<script>`
block, and replace it with your deployed address:

```js
const CONTRACT_ADDRESS = "0x0000000000000000000000000000000000dEaD";
```

Then just open the file in a browser (or host it anywhere static — GitHub
Pages, Vercel, Netlify all work with zero config since it's a single HTML
file). Needs a browser wallet (BO Wallet or MetaMask) with the BOT Chain
testnet added.

## Demo script for judges (~5 minutes)

1. **Request** — connect a school's wallet (e.g. "LAUTECH Blockchain
   Community"), submit an issuer request. Point out: this alone grants
   nothing yet.
2. **Approve** — switch to the deployer/admin wallet, go to the Admin tab,
   approve that address. Explain in one sentence why this step exists: it's
   the point where a human confirms the wallet really belongs to the real
   institution, closing the "anyone could register as LAUTECH" hole.
3. **Issue** — back on the now-approved issuer wallet, fill in a real
   student's details (Sharon Adebayo — Solidity Fundamentals — Completed
   with Distinction — LAUTECH — today's date), issue it. Narrate what's
   happening: pinned to IPFS, hashed, sent on-chain, QR generated only
   after confirmation. Show the resulting certificate ID and QR.
4. **Verify (genuine)** — scan the QR (or open the printed verify link) on
   a second device/tab. Green seal, "Hash matches — content unaltered."
5. **Verify (tampered) — the money shot** — go to the "Advanced: paste
   content" box, paste the *same* canonical JSON but change one word (e.g.
   `"Distinction"` → `"Merit"`), click verify. Shows no match / integrity
   failure. This proves the tamper-detection without needing to touch
   anything on real IPFS mid-demo.
6. **Verify (unapproved impersonator)** — from a third wallet, submit a
   request claiming to be "LAUTECH" too, *without* getting it approved, and
   try to issue a certificate. Show it revert.
7. **Show it on-chain** — pull up a transaction on `scan.botchain.ai` to
   prove it's not a database trick.
8. **(Optional) Revoke** — call `revokeCertificate`, verify by ID again,
   show the red "Revoked" seal.

## QR + IPFS verification (added on top of the original build)

**No contract changes were needed for this.** `metadataURI` already existed
on `Certificate`, and Solidity auto-generates a public getter for the
`certificates` mapping — that getter is where `docHash` comes from during
verification. Same deployed address, same ABI, same tests, all still 19/19
passing.

**What's new, all in `frontend/index.html`:**

- **Issue tab** now takes structured fields (student name, qualification,
  institution, date) instead of one free-text box. These get assembled into
  one canonical JSON string, hashed with keccak256, and that exact JSON is
  pinned to IPFS via Pinata *before* the on-chain transaction is sent. The
  QR code is only generated after the transaction confirms — a failed
  transaction never produces a "valid-looking" QR.
- **Verify tab**'s "Verify certificate" button now does the full chain:
  read on-chain status → fetch the pinned JSON from IPFS → recompute its
  hash → compare against the on-chain hash → show a clear VERIFIED /
  TAMPERED / METADATA UNREACHABLE result. IPFS being briefly down is shown
  as a warning, never as "invalid" — those are different failure modes and
  the UI doesn't conflate them.
- **QR auto-verify**: opening the page as `index.html?certId=7` jumps
  straight to the Verify tab and runs the check automatically — this is
  what an employer scanning a QR on a physical certificate actually
  experiences.
- The original "paste raw content to verify" box is untouched, kept as a
  manual/advanced fallback — handy for a live tampering demo without
  needing to actually edit anything on IPFS (see demo script below).

**Setup:** get a free JWT at pinata.cloud (API Keys → New Key), paste it
into the box near the top of the page. It's stored in that browser's
`localStorage` only — never sent anywhere but Pinata's API. Only needed for
issuing; verifying works without it.

## Known limitations (be upfront about these if asked)

- Owner approval is a single admin key in this build (whoever deployed the
  contract). That's fine for a hackathon demo, but it's a central point of
  trust/failure at real scale — a production version would want a
  multi-signature committee (e.g. 3-of-5 known reviewers) approving
  issuers instead of one wallet.
- QR generation calls a free public API (`api.qrserver.com`) rather than a
  client-side library — simplest option for a single dependency-free HTML
  file, but it does mean the verify-URL is sent to a third party at
  generation time (not at scan/verify time — the actual verification never
  touches this service). If this matters for your context, swapping in a
  client-side JS QR library (e.g. `qrcode.js`) later is a small, isolated
  change — only `qrImageURL()` would need to change.
- No on-chain storage of the actual certificate document — only its hash.
  The `metadataURI` field is where you'd point to the real file (IPFS is
  the natural choice, since it's also content-addressed and reinforces the
  "tamper-evident" story end to end).
- No batch issuance yet (one certificate per transaction) — fine for a
  demo, worth adding if this goes further (e.g. a whole graduating class
  issued in one call to cut gas costs).
