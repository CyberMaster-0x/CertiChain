require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS with secure origins
const allowedOrigins = [
  "https://cybermaster-0x.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, or local testing if needed)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    } else {
      return callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

app.use(express.json());

// Helper function to validate certificate metadata
function validateMetadata(canonicalJSONString) {
  if (typeof canonicalJSONString !== "string") {
    throw new Error("Metadata must be a string representation of canonical JSON");
  }

  let fields;
  try {
    fields = JSON.parse(canonicalJSONString);
  } catch (err) {
    throw new Error("Metadata string is not valid JSON");
  }

  // Define exact required keys for certichain-v1
  const requiredKeys = ["studentName", "qualification", "institution", "issuedDate", "note", "schema"];
  
  // Verify that there are no missing or extra keys
  const actualKeys = Object.keys(fields);
  for (const key of requiredKeys) {
    if (!actualKeys.includes(key)) {
      throw new Error(`Missing required field: ${key}`);
    }
  }
  for (const key of actualKeys) {
    if (!requiredKeys.includes(key)) {
      throw new Error(`Unrecognized field: ${key}`);
    }
  }

  // Validate value types and basic constraints
  if (typeof fields.studentName !== "string" || fields.studentName.trim() === "") {
    throw new Error("studentName must be a non-empty string");
  }
  if (typeof fields.qualification !== "string" || fields.qualification.trim() === "") {
    throw new Error("qualification must be a non-empty string");
  }
  if (typeof fields.institution !== "string" || fields.institution.trim() === "") {
    throw new Error("institution must be a non-empty string");
  }
  if (typeof fields.issuedDate !== "string" || fields.issuedDate.trim() === "") {
    throw new Error("issuedDate must be a non-empty string");
  }
  if (typeof fields.note !== "string") {
    throw new Error("note must be a string");
  }
  if (fields.schema !== "certichain-v1") {
    throw new Error("schema must be exactly 'certichain-v1'");
  }

  return fields;
}

// Metadata Storage Endpoint
app.post("/api/certificates/metadata", async (req, res) => {
  const { canonicalJSON } = req.body;

  // 1. Verify PINATA_JWT is configured
  const pinataJwt = process.env.PINATA_JWT;
  if (!pinataJwt || pinataJwt.trim() === "" || pinataJwt === "replace_with_your_server_side_pinata_jwt") {
    console.error("[Config Error] PINATA_JWT is not set or misconfigured in server environment variables.");
    return res.status(500).json({ error: "IPFS storage is not configured" });
  }

  // 2. Validate metadata
  let parsedFields;
  try {
    parsedFields = validateMetadata(canonicalJSON);
  } catch (validationError) {
    console.warn(`[Validation Failure] ${validationError.message}`);
    return res.status(400).json({ error: "Invalid certificate metadata" });
  }

  // 3. Upload raw JSON structure to Pinata
  try {
    // Construct request body that preserves canonical order in nested pinataContent
    const pinataResponse = await axios.post(
      "https://api.pinata.cloud/pinning/pinJSONToIPFS",
      {
        pinataContent: parsedFields,
        pinataMetadata: {
          name: `certichain-${parsedFields.studentName.replace(/[^a-zA-Z0-9]/g, "_")}-${Date.now()}.json`
        }
      },
      {
        headers: {
          "Authorization": `Bearer ${pinataJwt}`,
          "Content-Type": "application/json"
        },
        timeout: 10000 // 10 second timeout
      }
    );

    const cid = pinataResponse.data.IpfsHash;
    if (!cid) {
      console.error("[IPFS Error] Pinata request succeeded but did not return a valid IPFS CID.");
      return res.status(502).json({ error: "IPFS upload failed" });
    }

    // Return only the metadata URI safely without leaking any credentials
    return res.status(200).json({
      metadataURI: `ipfs://${cid}`
    });

  } catch (uploadError) {
    // Log the actual error securely on the server console (never return to client)
    console.error(
      "[IPFS Error] Pinata pinning request failed:",
      uploadError.response ? uploadError.response.data : uploadError.message
    );
    return res.status(502).json({ error: "IPFS upload failed" });
  }
});

// Universal secure error catcher
app.use((err, req, res, next) => {
  console.error("[Server Error] Unhandled exception occurred:", err.message);
  return res.status(500).json({ error: "Unable to store certificate metadata" });
});

// Start the server
app.listen(PORT, () => {
  console.log(`[Server] CertiChain secure IPFS backend running on port ${PORT}`);
});
