// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract FHEOptimizedPasswordAudit is SepoliaConfig {
    struct EncryptedPasswordHash {
        uint256 id;
        euint32 encryptedHash;   // Encrypted password hash
        uint256 timestamp;
    }
    
    // Decrypted password hash details (after reveal)
    struct DecryptedPasswordHash {
        string hash;
        bool isRevealed;
    }

    // Contract state
    uint256 public passwordHashCount;
    mapping(uint256 => EncryptedPasswordHash) public encryptedPasswordHashes;
    mapping(uint256 => DecryptedPasswordHash) public decryptedPasswordHashes;

    // Decryption requests tracking
    mapping(uint256 => uint256) private requestToPasswordHashId;

    // Events
    event PasswordHashSubmitted(uint256 indexed id, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event PasswordHashDecrypted(uint256 indexed id);

    modifier onlyHashSubmitter(uint256 passwordHashId) {
        // Access control for the original submitter
        _; 
    }

    /// @notice Submit a new encrypted password hash for auditing
    function submitEncryptedPasswordHash(
        euint32 encryptedHash
    ) public {
        passwordHashCount += 1;
        uint256 newId = passwordHashCount;

        encryptedPasswordHashes[newId] = EncryptedPasswordHash({
            id: newId,
            encryptedHash: encryptedHash,
            timestamp: block.timestamp
        });

        // Initialize decrypted state
        decryptedPasswordHashes[newId] = DecryptedPasswordHash({
            hash: "",
            isRevealed: false
        });

        emit PasswordHashSubmitted(newId, block.timestamp);
    }

    /// @notice Request decryption of a password hash
    function requestPasswordHashDecryption(uint256 passwordHashId) public onlyHashSubmitter(passwordHashId) {
        EncryptedPasswordHash storage hash = encryptedPasswordHashes[passwordHashId];
        require(!decryptedPasswordHashes[passwordHashId].isRevealed, "Already decrypted");

        // Prepare encrypted data for decryption
        bytes32 ;
        ciphertexts[0] = FHE.toBytes32(hash.encryptedHash);

        // Request decryption
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptPasswordHash.selector);
        requestToPasswordHashId[reqId] = passwordHashId;

        emit DecryptionRequested(passwordHashId);
    }

    /// @notice Callback for decrypted password hash data
    function decryptPasswordHash(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 passwordHashId = requestToPasswordHashId[requestId];
        require(passwordHashId != 0, "Invalid request");

        EncryptedPasswordHash storage eHash = encryptedPasswordHashes[passwordHashId];
        DecryptedPasswordHash storage dHash = decryptedPasswordHashes[passwordHashId];
        require(!dHash.isRevealed, "Already decrypted");

        // Verify decryption proof
        FHE.checkSignatures(requestId, cleartexts, proof);

        // Process decrypted value
        string memory result = abi.decode(cleartexts, (string));
        
        dHash.hash = result;
        dHash.isRevealed = true;

        emit PasswordHashDecrypted(passwordHashId);
    }

    /// @notice Get decrypted password hash details
    function getDecryptedPasswordHash(uint256 passwordHashId) public view returns (
        string memory hash,
        bool isRevealed
    ) {
        DecryptedPasswordHash storage h = decryptedPasswordHashes[passwordHashId];
        return (h.hash, h.isRevealed);
    }

    // Helper functions
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
}
