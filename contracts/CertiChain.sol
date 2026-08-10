// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title CertiChain
/// @notice Tamper-proof certificates for schools, training programs, and
///         professional credentials on BOT Chain. An issuer (a school,
///         bootcamp, or certifying body) registers, then mints certificates
///         bound to a document hash. Anyone can verify a certificate's
///         authenticity and status without trusting a centralized database.
contract CertiChain {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct Issuer {
        string name;        // e.g. "LAUTECH Blockchain Community"
        bool isPending;      // requested but not yet approved by the platform owner
        bool isRegistered;   // approved and allowed to issue certificates
        bool isActive;       // owner can deactivate a compromised/approved issuer
        uint256 certCount;
    }

    struct Certificate {
        address issuer;
        address recipient;
        bytes32 docHash;      // keccak256 hash of the certificate document/data
        string metadataURI;   // optional: IPFS/HTTP link to the full certificate
        uint64 issuedAt;
        bool revoked;
        uint64 revokedAt;
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    address public owner;

    mapping(address => Issuer) public issuers;
    address[] public issuerList;

    uint256 public certCounter;
    mapping(uint256 => Certificate) public certificates;

    // Fast lookup: has this exact document hash ever been issued, and by
    // which certificate ID? Prevents duplicate issuance and lets anyone
    // verify a document by hashing it themselves — no need to know the ID.
    mapping(bytes32 => uint256) public hashToCertId; // 0 = not found
    mapping(bytes32 => bool) public hashExists;

    // recipient => list of their certificate IDs
    mapping(address => uint256[]) private recipientCerts;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event IssuerRequested(address indexed issuer, string name);
    event IssuerApproved(address indexed issuer, string name);
    event IssuerRejected(address indexed issuer);
    event IssuerStatusChanged(address indexed issuer, bool isActive);

    event CertificateIssued(
        uint256 indexed certId,
        address indexed issuer,
        address indexed recipient,
        bytes32 docHash,
        string metadataURI
    );

    event CertificateRevoked(uint256 indexed certId, address indexed issuer, uint64 revokedAt);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error NotOwner();
    error NotIssuer();
    error IssuerInactive();
    error AlreadyRegistered();
    error AlreadyPending();
    error NoPendingRequest();
    error DuplicateDocument();
    error CertDoesNotExist();
    error NotCertIssuer();
    error AlreadyRevoked();

    // ---------------------------------------------------------------------
    // Modifiers
    // ---------------------------------------------------------------------

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyActiveIssuer() {
        Issuer storage iss = issuers[msg.sender];
        if (!iss.isRegistered) revert NotIssuer();
        if (!iss.isActive) revert IssuerInactive();
        _;
    }

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    constructor() {
        owner = msg.sender;
    }

    // ---------------------------------------------------------------------
    // Issuer management
    // ---------------------------------------------------------------------

    /// @notice Step 1 of 2: any wallet can REQUEST to become an issuer.
    ///         This does NOT grant issuing rights — it just puts the
    ///         request on-chain for the platform owner to review off-chain
    ///         (e.g. confirming the wallet really belongs to the school
    ///         that claims it, via an official email, letter, or call)
    ///         before approving it in the next step. This closes the gap
    ///         where anyone could register as "LAUTECH" and issue
    ///         self-certified credentials that render as "Verified."
    function requestIssuerStatus(string calldata name) external {
        Issuer storage iss = issuers[msg.sender];
        if (iss.isRegistered) revert AlreadyRegistered();
        if (iss.isPending) revert AlreadyPending();

        iss.name = name;
        iss.isPending = true;
        emit IssuerRequested(msg.sender, name);
    }

    /// @notice Step 2 of 2: platform owner approves a pending request
    ///         AFTER verifying off-chain that the wallet genuinely
    ///         belongs to the institution it claims to represent.
    function approveIssuer(address issuerAddr) external onlyOwner {
        Issuer storage iss = issuers[issuerAddr];
        if (!iss.isPending) revert NoPendingRequest();

        iss.isPending = false;
        iss.isRegistered = true;
        iss.isActive = true;
        issuerList.push(issuerAddr);

        emit IssuerApproved(issuerAddr, iss.name);
    }

    /// @notice Owner can reject a pending request instead of approving it
    ///         (e.g. couldn't confirm the wallet belongs to who it claims).
    function rejectIssuer(address issuerAddr) external onlyOwner {
        Issuer storage iss = issuers[issuerAddr];
        if (!iss.isPending) revert NoPendingRequest();

        iss.isPending = false;
        iss.name = "";
        emit IssuerRejected(issuerAddr);
    }

    /// @notice Platform owner can deactivate a compromised or fraudulent
    ///         issuer even after approval. Already-issued certificates
    ///         remain visible on-chain but `verifyCertificate` will flag
    ///         the issuer as inactive, so their past certs stop showing
    ///         as "Verified."
    function setIssuerActive(address issuerAddr, bool active) external onlyOwner {
        if (!issuers[issuerAddr].isRegistered) revert NotIssuer();
        issuers[issuerAddr].isActive = active;
        emit IssuerStatusChanged(issuerAddr, active);
    }

    // ---------------------------------------------------------------------
    // Certificate issuance & revocation
    // ---------------------------------------------------------------------

    /// @notice Issue a certificate. `docHash` should be keccak256 of the
    ///         canonical certificate content (name + course + date + any
    ///         other fields you want tamper-evident) computed off-chain.
    function issueCertificate(
        address recipient,
        bytes32 docHash,
        string calldata metadataURI
    ) external onlyActiveIssuer returns (uint256 certId) {
        if (hashExists[docHash]) revert DuplicateDocument();

        certCounter += 1;
        certId = certCounter;

        certificates[certId] = Certificate({
            issuer: msg.sender,
            recipient: recipient,
            docHash: docHash,
            metadataURI: metadataURI,
            issuedAt: uint64(block.timestamp),
            revoked: false,
            revokedAt: 0
        });

        hashToCertId[docHash] = certId;
        hashExists[docHash] = true;
        recipientCerts[recipient].push(certId);
        issuers[msg.sender].certCount += 1;

        emit CertificateIssued(certId, msg.sender, recipient, docHash, metadataURI);
    }

    /// @notice Only the original issuer can revoke (e.g. cheating found
    ///         after the fact, or the credential expired/was rescinded).
    function revokeCertificate(uint256 certId) external {
        Certificate storage cert = certificates[certId];
        if (cert.issuedAt == 0) revert CertDoesNotExist();
        if (cert.issuer != msg.sender) revert NotCertIssuer();
        if (cert.revoked) revert AlreadyRevoked();

        cert.revoked = true;
        cert.revokedAt = uint64(block.timestamp);

        emit CertificateRevoked(certId, msg.sender, cert.revokedAt);
    }

    // ---------------------------------------------------------------------
    // Verification (read-only)
    // ---------------------------------------------------------------------

    struct VerificationResult {
        bool exists;
        bool valid;          // exists && !revoked && issuer still active
        bool revoked;
        bool issuerActive;
        uint256 certId;
        address issuer;
        string issuerName;
        address recipient;
        string metadataURI;
        uint64 issuedAt;
        uint64 revokedAt;
    }

    /// @notice Verify a certificate by its on-chain ID.
    function verifyCertificate(uint256 certId) public view returns (VerificationResult memory result) {
        Certificate storage cert = certificates[certId];
        if (cert.issuedAt == 0) {
            return result; // all-zero/false struct => "does not exist"
        }
        Issuer storage iss = issuers[cert.issuer];

        result.exists = true;
        result.revoked = cert.revoked;
        result.issuerActive = iss.isActive;
        result.valid = !cert.revoked && iss.isActive;
        result.certId = certId;
        result.issuer = cert.issuer;
        result.issuerName = iss.name;
        result.recipient = cert.recipient;
        result.metadataURI = cert.metadataURI;
        result.issuedAt = cert.issuedAt;
        result.revokedAt = cert.revokedAt;
    }

    /// @notice Verify a certificate by re-hashing the document off-chain
    ///         and checking it against what's on-chain. This is the "did
    ///         someone tamper with this PDF" check.
    function verifyByHash(bytes32 docHash) external view returns (VerificationResult memory result) {
        if (!hashExists[docHash]) {
            return result;
        }
        return verifyCertificate(hashToCertId[docHash]);
    }

    /// @notice All certificate IDs held by a recipient.
    function getCertificatesOf(address recipient) external view returns (uint256[] memory) {
        return recipientCerts[recipient];
    }

    /// @notice Number of registered issuers (for UI listing).
    function issuerCount() external view returns (uint256) {
        return issuerList.length;
    }
}
