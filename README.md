# CertiChain

Tamper-evident certificates for schools, training programs, and professional
credentials, issued and verified on **BOT Chain Mainnet**.

An approved issuer (a school, bootcamp, or certifying body) issues a
certificate bound to a `keccak256` hash of its content. Anyone — an
employer, another school, a stranger with a phone and no wallet installed —
can verify a certificate's authenticity and status by scanning a QR code,
without trusting a centralized database and without needing to trust the
issuer's word after the fact: change one character of the original content
and the hash no longer matches anything on-chain.

Built for the BOT Chain Africa Pioneer Builder Challenge.

- **Live contract (BOT Chain Mainnet):** `0x6b58a85E79a4b46D416A2c5B6E77D4BADC48111a`
- **Chain ID:** 677 (`0x2A5`)
- **Explorer:** https://scan.botchain.ai
- **RPC:** https://rpc.botchain.ai

---

## The three different secrets/keys in this project (read this first)

This project involves three completely different things that are easy to
confuse. Mixing them up is the single most common way to accidentally leak
something you shouldn't.

| # | What it is | Who has it | What it's for | Ever goes in the repo? |
|---|---|---|---|---|
| 1 | **Wallet private key** (MetaMask / BO Wallet) | The contract deployer, and separately each issuer/admin | Signs blockchain transactions (deploying the contract, issuing certificates, approving issuers) | **Never.** Only in your own `.env` (git-ignored) or your wallet extension. |
| 2 | **Pinata JWT** (IPFS API key) | Only whoever is currently issuing a certificate | Uploads certificate metadata to IPFS before it's referenced on-chain | **Never.** Entered into a field in the browser, kept only in that browser's `localStorage`, never written into the HTML source. |
| 3 | **Certificate data / hash / IPFS metadata** | Public, by design | What verification checks against | **Yes, this is meant to be public.** It's the whole point — anyone with a certificate ID can read it. |

If a Pinata JWT or a private key is ever pasted into a file that gets
committed, treat it as burned: revoke/rotate it immediately (Pinata
dashboard for the JWT, a fresh wallet for a private key). Never rely on
deleting it from git history alone.

---

## Who needs what

This trips people up, so it's worth stating plainly:

- **Issuing a certificate** requires: a wallet connected to BOT Chain
  Mainnet, that wallet already approved as an issuer, and a Pinata JWT
  pasted into the page (needed to upload the certificate metadata to
  IPFS before the transaction is sent).
- **Verifying a certificate** requires: nothing. No wallet, no JWT, no
  browser extension. Verification reads directly from BOT Chain's public
  RPC (`rpc.botchain.ai`) via a plain `ethers.JsonRpcProvider`, and fetches
  metadata from a public IPFS gateway. It works the same whether or not
  `window.ethereum` exists in the browser at all — this matters because
  most people scanning a certificate's QR code are on a phone with no
  wallet app installed.
- **Scanning a QR code** requires: a camera. The QR encodes only a
  verification URL (`?certId=<id>`) — no student data, no wallet
  addresses, no IPFS data is in the QR itself. Opening that URL
  auto-triggers full verification with no further clicks.
- **Approving/rejecting an issuer** requires: the contract owner's wallet
  specifically — `approveIssuer` and `rejectIssuer` both revert for
  anyone else.

## Certificate data is public — do not put sensitive information in it

Every certificate's metadata (student name, qualification, institution,
date, note) is uploaded to IPFS and its hash is stored on a public
blockchain. **Anyone who has, or guesses, a certificate ID can read this
data.** Do not put phone numbers, government ID numbers, home addresses,
passwords, or any other sensitive personal information into the
certificate fields. Treat every field the same way you'd treat text
printed on a certificate that's going to be handed to a stranger — because
that's exactly what it is.

---

## How it works

### Issuing a certificate

1. Issuer connects a wallet; the app switches it to BOT Chain Mainnet
   automatically (chain ID 677), adding the network first if the wallet
   doesn't already know it.
2. Issuer fills in: recipient wallet address, student name, qualification,
   institution, date issued, and an optional note.
3. The app assembles these into one canonical JSON object:
   ```json
   { "studentName": "...", "qualification": "...", "institution": "...", "issuedDate": "...", "note": "...", "schema": "certichain-v1" }
   ```
   Fields are explicitly re-typed in a fixed order (not just
   `JSON.stringify`'d as given), so the same logical certificate always
   produces the same hash regardless of what order the form happened to
   read fields in.
4. That JSON is hashed with `keccak256` in the browser.
5. The exact same JSON is uploaded to IPFS via Pinata.
6. `issueCertificate(recipient, docHash, metadataURI)` is called on-chain.
7. Once the transaction confirms, the real certificate ID is read back out
   of the `CertificateIssued` event (never assumed or guessed).
8. A verification URL (`?certId=<id>`) and a QR code encoding that URL are
   generated **only after confirmation** — a failed transaction never
   produces a QR that looks valid.
9. The issuer gets: certificate ID, student/qualification/institution
   summary, the QR code, a "Download QR Code" button (saves an actual PNG
   file), and a "Copy Verification Link" button.

### Verifying a certificate

1. Opening the app with `?certId=123` in the URL (what the QR encodes)
   automatically switches to the Verify tab and runs verification — no
   clicks needed.
2. Verification reads the certificate from BOT Chain (existence, revoked
   status, issuer-active status).
3. It fetches the certificate's metadata from IPFS.
4. It recomputes the `keccak256` hash of the fetched content, using the
   identical canonicalization logic used at issuance.
5. It compares the recomputed hash against the on-chain hash.
6. The result is shown employer-first: student, qualification,
   institution, date, certificate status, and a plain "Verified" /
   "Not verified" / "Could not check right now" integrity line —
   technical fields (certificate ID, issuer/recipient wallet addresses,
   the on-chain hash, the IPFS URI, the originating transaction) are
   available under a "View blockchain details" disclosure rather than
   shown first.
7. If IPFS happens to be unreachable at that moment, this is shown as a
   distinct "could not check" state, not as "invalid" — those are
   different situations and the UI doesn't conflate them.

A second, manual verification path exists (the "paste raw content" box)
for pasting exact certificate content directly and checking it against a
hash — useful for a live tampering demo without needing to alter anything
on real IPFS.

### Issuer registration, approval, and revocation

- Any wallet can call `requestIssuerStatus(name)` — this only records a
  request, it does **not** grant issuing rights.
- Only the contract owner can call `approveIssuer(address)` or
  `rejectIssuer(address)`. Before approving, the owner is expected to
  confirm off-chain (email, call, official letter) that the wallet really
  belongs to the institution it claims to represent — the contract can't
  verify real-world identity by itself, only that a specific wallet
  address was approved.
- One wallet can only ever represent one issuer identity/name. The
  frontend checks and reports the wallet's current status (already
  approved / already pending / already registered but inactive) with
  plain-language messages before sending a transaction, rather than
  showing raw Solidity revert strings like `NotOwner` or
  `AlreadyRegistered` to the user.
- The owner can also deactivate a previously-approved issuer at any time
  (`setIssuerActive`); certificates already issued by that wallet remain
  on-chain but stop showing as "Verified" once the issuer is inactive.
- The original issuer of a specific certificate (and only that issuer) can
  revoke it later. Revoked certificates remain visible with a clear
  "Revoked" status rather than disappearing.

---

## What's stored where

| Data | Location | Public? |
|---|---|---|
| Certificate document hash (`docHash`) | On-chain | Yes |
| Issuer address, recipient address, issued timestamp, revoked status | On-chain | Yes |
| IPFS metadata URI | On-chain | Yes |
| Student name, qualification, institution, date, note | IPFS (referenced by the on-chain URI) | Yes |
| Issuer's organization name, approval status | On-chain | Yes |
| Full certificate document/PDF | Not stored anywhere by this app | N/A |
| Wallet private keys | Never touch this app's storage | N/A |
| Pinata JWT | Browser `localStorage` only, per-device | No (but never treat it as fully safe either — see above) |

---

## Project structure

```
contracts/CertiChain.sol           the contract
test/CertiChain.test.js            19 tests: issuance, verification, revocation, access control
test/frontend-integration.test.js  7 tests: exercises the frontend's actual ABI/hashing code end-to-end
scripts/deploy.js                  deploy script
frontend/index.html                single-file app: issue / verify / register / admin approve
compile.js                         compiles via the npm `solc` package (see note below)
hardhat.config.js                  network config for BOT Chain mainnet (+ testnet placeholder)
.env.example                       template for local secrets, copy to .env
.gitignore                         keeps node_modules, .env, and build output out of the repo
```

The frontend is a single static HTML file with no build step — all
dependencies (`ethers.js`, fonts) load from a CDN at runtime.

## Setup

```bash
npm install
cp .env.example .env
```

Fill in `.env` with your own deployer wallet's private key if you intend to
redeploy or interact with the contract from scripts. This is **not**
needed just to use the already-deployed frontend.

## Compile

```bash
npm run compile
```

This project was originally built in a sandboxed environment that blocked
`binaries.soliditylang.org` (where Hardhat normally auto-downloads the
Solidity compiler from), so `compile.js` compiles via the `solc` npm
package instead and writes the artifact by hand in Hardhat's expected
format. On a normal machine with unrestricted internet access, plain
`npx hardhat compile` will also work — `compile.js` is kept as a reliable
fallback either way.

## Test

```bash
npm test
```

Runs 26 tests total: 19 exercising the contract directly (issuance,
duplicate-hash prevention, revocation, issuer request/approve/reject,
access control), and 7 that extract the actual ABI and hashing functions
out of `frontend/index.html` and run them against a real deployed
contract on a local chain — this catches ABI mismatches or hashing bugs
that would otherwise only surface as a silent failure in the browser.

## Deploy

```bash
npm run deploy:mainnet
```

The contract currently live at `0x6b58a85E79a4b46D416A2c5B6E77D4BADC48111a`
on BOT Chain Mainnet was deployed this way. A `deploy:testnet` script also
exists in `package.json`, but `hardhat.config.js` still has placeholder
values for the testnet RPC/chain ID — fill those in from
`faucet.botchain.ai/basic` if you need a testnet deployment.

## Verify the contract

BOT Chain's explorer (`scan.botchain.ai`) is Blockscout-based, not
Etherscan, so `npx hardhat verify` will not work out of the box. Verify
manually at `https://scan.botchain.ai/contract-verification`, using
`contracts/CertiChain.sol`, compiler version `0.8.24`, optimizer on
(200 runs).

## Frontend configuration

`frontend/index.html` already has `CONTRACT_ADDRESS` set to the live
mainnet deployment above, and the ABI matches the deployed contract. If
you redeploy, update `CONTRACT_ADDRESS` at the top of the `<script>`
block to the new address — nothing else in the frontend needs to change
as a result of a redeploy.

The Pinata JWT is entered directly into the page (a field near the top),
not hardcoded anywhere in the source — see "the three secrets" above.

## Deploying the frontend (GitHub Pages)

Since `frontend/index.html` is a single static file with no build step,
GitHub Pages deployment is direct:

1. Push the repository to GitHub.
2. In the repo, go to **Settings -> Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select your default branch, and set the folder to `/frontend` (or move
   `index.html` to the repo root first, if you'd rather serve it from
   there).
5. Save. GitHub will publish it at
   `https://<your-username>.github.io/<repo-name>/`.

Once published, certificate verification works from that URL with no
wallet required (see "who needs what" above) — this is what makes a QR
code printed on a physical certificate actually useful to someone
scanning it with a phone.

## Demo script

1. **Request -> approve an issuer.** Connect an issuer wallet, submit a
   request. Switch to the contract-owner wallet, approve it from the
   Admin tab. Point out that the request alone grants nothing.
2. **Issue a certificate.** Fill in real-looking details, paste a Pinata
   JWT, issue. Show the QR code and the two buttons (Download QR Code,
   Copy Verification Link).
3. **Verify genuinely.** Scan the QR (or open the link) from a phone with
   no wallet app installed. Show it verifying successfully with no wallet
   prompt at any point.
4. **Demonstrate tamper detection.** Use the "paste raw content" box:
   paste the same certificate content with one word changed, show the
   hash comparison fail.
5. **Demonstrate the fake-issuer protection.** From an unapproved third
   wallet, submit an issuer request but do not approve it, then attempt
   to issue a certificate anyway — show it revert with a plain-language
   error rather than a raw Solidity error name.
6. **(Optional) Revoke.** Revoke the certificate issued in step 2,
   re-verify, show the status change to "Revoked."

---

## Known limitations

- **Single admin key.** Issuer approval currently depends on one contract
  owner wallet. Fine for a hackathon demo; a production version would
  want multi-signature approval (e.g. 3-of-5 known reviewers) instead of
  one wallet being able to unilaterally approve or reject issuers.
- **QR generation uses a third-party API** (`api.qrserver.com`) rather
  than a client-side library, to keep the frontend a single
  dependency-free HTML file. The verification URL is sent to that service
  at QR-generation time (not at scan/verify time — actual verification
  never touches it). Swapping in a client-side QR library later is a
  small, isolated change if this matters for your context.
- **No wallet-recovery flow.** If an approved issuer's wallet is lost,
  there is currently no built-in process to transfer their approved
  status to a new address; this would need to be added if it becomes a
  real requirement.
- **No batch issuance.** Certificates are issued one at a time (one
  transaction each) — fine for a demo, worth adding if this is used for
  an entire graduating class at once, to reduce total gas cost.
- **`hardhat.config.js`'s testnet network is a placeholder** (RPC and
  chain ID are not filled in with real values) since the project settled
  on mainnet deployment; only `botchainMainnet` in that config is
  currently exercised in practice.

## Security checklist before pushing to a public repo

- [ ] `.env` is not committed (already covered by `.gitignore` — double
      check anyway before every push).
- [ ] No Pinata JWT appears anywhere in `frontend/index.html` or any
      commit history.
- [ ] No private key or seed phrase appears anywhere in the repo or
      commit history.
- [ ] If any of the above was ever exposed, it has been revoked/rotated,
      not just deleted from the current file.