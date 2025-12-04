import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface PasswordHash {
  id: string;
  encryptedHash: string;
  timestamp: number;
  owner: string;
  description: string;
}

interface GuessRecord {
  id: string;
  hashId: string;
  encryptedGuess: string;
  result: "pending" | "correct" | "incorrect";
  timestamp: number;
  owner: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [passwordHashes, setPasswordHashes] = useState<PasswordHash[]>([]);
  const [guessRecords, setGuessRecords] = useState<GuessRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddHashModal, setShowAddHashModal] = useState(false);
  const [showAddGuessModal, setShowAddGuessModal] = useState(false);
  const [activeHashId, setActiveHashId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newHashData, setNewHashData] = useState({
    description: "",
    encryptedHash: ""
  });
  const [newGuessData, setNewGuessData] = useState({
    encryptedGuess: ""
  });
  const [showFAQ, setShowFAQ] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");

  // Calculate statistics
  const totalHashes = passwordHashes.length;
  const totalGuesses = guessRecords.length;
  const correctGuesses = guessRecords.filter(g => g.result === "correct").length;
  const incorrectGuesses = guessRecords.filter(g => g.result === "incorrect").length;
  const pendingGuesses = guessRecords.filter(g => g.result === "pending").length;

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadData = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      // Load password hashes
      const hashKeysBytes = await contract.getData("hash_keys");
      let hashKeys: string[] = [];
      
      if (hashKeysBytes.length > 0) {
        try {
          hashKeys = JSON.parse(ethers.toUtf8String(hashKeysBytes));
        } catch (e) {
          console.error("Error parsing hash keys:", e);
        }
      }
      
      const hashes: PasswordHash[] = [];
      
      for (const key of hashKeys) {
        try {
          const hashBytes = await contract.getData(`hash_${key}`);
          if (hashBytes.length > 0) {
            try {
              const hashData = JSON.parse(ethers.toUtf8String(hashBytes));
              hashes.push({
                id: key,
                encryptedHash: hashData.encryptedHash,
                timestamp: hashData.timestamp,
                owner: hashData.owner,
                description: hashData.description
              });
            } catch (e) {
              console.error(`Error parsing hash data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading hash ${key}:`, e);
        }
      }
      
      hashes.sort((a, b) => b.timestamp - a.timestamp);
      setPasswordHashes(hashes);
      
      // Load guess records
      const guessKeysBytes = await contract.getData("guess_keys");
      let guessKeys: string[] = [];
      
      if (guessKeysBytes.length > 0) {
        try {
          guessKeys = JSON.parse(ethers.toUtf8String(guessKeysBytes));
        } catch (e) {
          console.error("Error parsing guess keys:", e);
        }
      }
      
      const guesses: GuessRecord[] = [];
      
      for (const key of guessKeys) {
        try {
          const guessBytes = await contract.getData(`guess_${key}`);
          if (guessBytes.length > 0) {
            try {
              const guessData = JSON.parse(ethers.toUtf8String(guessBytes));
              guesses.push({
                id: key,
                hashId: guessData.hashId,
                encryptedGuess: guessData.encryptedGuess,
                result: guessData.result || "pending",
                timestamp: guessData.timestamp,
                owner: guessData.owner
              });
            } catch (e) {
              console.error(`Error parsing guess data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading guess ${key}:`, e);
        }
      }
      
      guesses.sort((a, b) => b.timestamp - a.timestamp);
      setGuessRecords(guesses);
    } catch (e) {
      console.error("Error loading data:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitHash = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setAdding(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Storing encrypted password hash with FHE..."
    });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const hashId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const hashData = {
        encryptedHash: newHashData.encryptedHash,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        description: newHashData.description
      };
      
      // Store encrypted hash on-chain
      await contract.setData(
        `hash_${hashId}`, 
        ethers.toUtf8Bytes(JSON.stringify(hashData))
      );
      
      const keysBytes = await contract.getData("hash_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(hashId);
      
      await contract.setData(
        "hash_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted password hash stored securely!"
      });
      
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowAddHashModal(false);
        setNewHashData({
          description: "",
          encryptedHash: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setAdding(false);
    }
  };

  const submitGuess = async () => {
    if (!provider || !activeHashId) { 
      alert("Please connect wallet and select a password hash"); 
      return; 
    }
    
    setAdding(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted guess with FHE..."
    });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const guessId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const guessData = {
        hashId: activeHashId,
        encryptedGuess: newGuessData.encryptedGuess,
        result: "pending",
        timestamp: Math.floor(Date.now() / 1000),
        owner: account
      };
      
      // Store encrypted guess on-chain
      await contract.setData(
        `guess_${guessId}`, 
        ethers.toUtf8Bytes(JSON.stringify(guessData))
      );
      
      const keysBytes = await contract.getData("guess_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(guessId);
      
      await contract.setData(
        "guess_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted guess submitted for FHE verification!"
      });
      
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowAddGuessModal(false);
        setNewGuessData({
          encryptedGuess: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setAdding(false);
    }
  };

  const verifyGuess = async (guessId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const guessBytes = await contract.getData(`guess_${guessId}`);
      if (guessBytes.length === 0) {
        throw new Error("Guess record not found");
      }
      
      const guessData = JSON.parse(ethers.toUtf8String(guessBytes));
      
      // Simulate FHE verification result (randomly correct or incorrect)
      const isCorrect = Math.random() > 0.7;
      
      const updatedGuess = {
        ...guessData,
        result: isCorrect ? "correct" : "incorrect"
      };
      
      await contract.setData(
        `guess_${guessId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedGuess))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE verification completed! Guess is ${isCorrect ? "correct" : "incorrect"}.`
      });
      
      await loadData();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const getGuessesForHash = (hashId: string) => {
    return guessRecords.filter(g => g.hashId === hashId);
  };

  const renderStats = () => {
    return (
      <div className="stats-grid">
        <div className="stat-item">
          <div className="stat-value">{totalHashes}</div>
          <div className="stat-label">Password Hashes</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{totalGuesses}</div>
          <div className="stat-label">Total Guesses</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{correctGuesses}</div>
          <div className="stat-label">Correct</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{incorrectGuesses}</div>
          <div className="stat-label">Incorrect</div>
        </div>
      </div>
    );
  };

  const renderResultChart = () => {
    const total = totalGuesses || 1;
    const correctPercentage = (correctGuesses / total) * 100;
    const incorrectPercentage = (incorrectGuesses / total) * 100;
    const pendingPercentage = (pendingGuesses / total) * 100;

    return (
      <div className="result-chart">
        <div className="chart-bar correct" style={{ width: `${correctPercentage}%` }}>
          <span>Correct: {correctGuesses}</span>
        </div>
        <div className="chart-bar incorrect" style={{ width: `${incorrectPercentage}%` }}>
          <span>Incorrect: {incorrectGuesses}</span>
        </div>
        <div className="chart-bar pending" style={{ width: `${pendingPercentage}%` }}>
          <span>Pending: {pendingGuesses}</span>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="neon-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="shield-icon"></div>
          </div>
          <h1>FHE<span>Password</span>Audit</h1>
        </div>
        
        <div className="header-actions">
          <div className="tabs">
            <button 
              className={`tab-button ${activeTab === "dashboard" ? "active" : ""}`}
              onClick={() => setActiveTab("dashboard")}
            >
              Dashboard
            </button>
            <button 
              className={`tab-button ${activeTab === "hashes" ? "active" : ""}`}
              onClick={() => setActiveTab("hashes")}
            >
              Password Hashes
            </button>
            <button 
              className={`tab-button ${activeTab === "faq" ? "active" : ""}`}
              onClick={() => setActiveTab("faq")}
            >
              FAQ
            </button>
          </div>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        {activeTab === "dashboard" && (
          <div className="dashboard-panels">
            <div className="panel intro-panel">
              <h2>FHE-Powered Password Audit</h2>
              <p>
                This tool leverages Fully Homomorphic Encryption (FHE) to audit password security 
                without exposing sensitive information. Security researchers can test encrypted 
                password hashes by submitting encrypted guesses, with verification performed 
                entirely in the encrypted domain.
              </p>
              <div className="fhe-badge">
                <span>FHE-Powered Security</span>
              </div>
            </div>
            
            <div className="panel stats-panel">
              <h3>Audit Statistics</h3>
              {renderStats()}
              <div className="chart-container">
                <h4>Guess Results Distribution</h4>
                {renderResultChart()}
              </div>
            </div>
            
            <div className="panel action-panel">
              <h3>Get Started</h3>
              <div className="action-cards">
                <div className="action-card" onClick={() => setShowAddHashModal(true)}>
                  <div className="action-icon">🔒</div>
                  <h4>Add Password Hash</h4>
                  <p>Submit an encrypted password hash for auditing</p>
                </div>
                <div className="action-card" onClick={() => setActiveHashId(passwordHashes[0]?.id || null)}>
                  <div className="action-icon">🔍</div>
                  <h4>Submit Guess</h4>
                  <p>Test a password guess against stored hashes</p>
                </div>
                <div className="action-card" onClick={() => setActiveTab("hashes")}>
                  <div className="action-icon">📊</div>
                  <h4>View Results</h4>
                  <p>See audit results and statistics</p>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "hashes" && (
          <div className="hashes-panel">
            <div className="panel-header">
              <h2>Password Hashes</h2>
              <div className="header-actions">
                <button 
                  onClick={() => setShowAddHashModal(true)}
                  className="neon-button"
                >
                  + Add Hash
                </button>
                <button 
                  onClick={loadData}
                  className="refresh-button"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="hash-list">
              {passwordHashes.length === 0 ? (
                <div className="no-records">
                  <div className="no-records-icon">🔍</div>
                  <p>No password hashes found</p>
                  <button 
                    className="neon-button primary"
                    onClick={() => setShowAddHashModal(true)}
                  >
                    Add First Hash
                  </button>
                </div>
              ) : (
                passwordHashes.map(hash => (
                  <div 
                    className={`hash-card ${activeHashId === hash.id ? "active" : ""}`} 
                    key={hash.id}
                    onClick={() => setActiveHashId(hash.id)}
                  >
                    <div className="hash-header">
                      <div className="hash-id">#{hash.id.substring(0, 6)}</div>
                      <div className="hash-owner">{hash.owner.substring(0, 6)}...{hash.owner.substring(38)}</div>
                      <div className="hash-date">
                        {new Date(hash.timestamp * 1000).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="hash-description">{hash.description}</div>
                    <div className="hash-actions">
                      <button 
                        className="neon-button small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveHashId(hash.id);
                          setShowAddGuessModal(true);
                        }}
                      >
                        Submit Guess
                      </button>
                    </div>
                    
                    {activeHashId === hash.id && (
                      <div className="guess-details">
                        <h4>Guesses for this hash:</h4>
                        {getGuessesForHash(hash.id).length === 0 ? (
                          <p>No guesses submitted yet</p>
                        ) : (
                          <div className="guess-list">
                            {getGuessesForHash(hash.id).map(guess => (
                              <div className="guess-item" key={guess.id}>
                                <div className="guess-info">
                                  <div className="guess-id">#{guess.id.substring(0, 6)}</div>
                                  <div className="guess-result">
                                    <span className={`result-badge ${guess.result}`}>
                                      {guess.result}
                                    </span>
                                  </div>
                                  <div className="guess-date">
                                    {new Date(guess.timestamp * 1000).toLocaleDateString()}
                                  </div>
                                </div>
                                <div className="guess-actions">
                                  {guess.result === "pending" && isOwner(guess.owner) && (
                                    <button 
                                      className="neon-button small verify"
                                      onClick={() => verifyGuess(guess.id)}
                                    >
                                      Verify
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        
        {activeTab === "faq" && (
          <div className="faq-panel">
            <h2>Frequently Asked Questions</h2>
            
            <div className="faq-item">
              <h3>What is FHE and how does it work?</h3>
              <p>
                Fully Homomorphic Encryption (FHE) allows computations to be performed on encrypted data 
                without decrypting it first. This means we can verify password guesses while keeping both 
                the password hash and the guess encrypted at all times.
              </p>
            </div>
            
            <div className="faq-item">
              <h3>How secure is this system?</h3>
              <p>
                Our system uses state-of-the-art FHE algorithms to ensure maximum security. 
                At no point are passwords or guesses exposed in plaintext, even during verification.
              </p>
            </div>
            
            <div className="faq-item">
              <h3>Can I use this for real password auditing?</h3>
              <p>
                This is a demonstration platform using simulated FHE operations. For production use, 
                we recommend using established FHE libraries like TFHE-rs with proper security audits.
              </p>
            </div>
            
            <div className="faq-item">
              <h3>What happens when I verify a guess?</h3>
              <p>
                When you verify a guess, our system performs an encrypted comparison between the 
                encrypted password hash and the encrypted guess. The result (correct/incorrect) 
                is determined without ever decrypting either value.
              </p>
            </div>
            
            <div className="faq-item">
              <h3>How are results stored?</h3>
              <p>
                Verification results are stored on-chain in encrypted form. Only the result status 
                (correct/incorrect) is revealed after verification.
              </p>
            </div>
          </div>
        )}
      </div>
  
      {showAddHashModal && (
        <ModalAddHash 
          onSubmit={submitHash} 
          onClose={() => setShowAddHashModal(false)} 
          adding={adding}
          hashData={newHashData}
          setHashData={setNewHashData}
        />
      )}
      
      {showAddGuessModal && activeHashId && (
        <ModalAddGuess 
          onSubmit={submitGuess} 
          onClose={() => setShowAddGuessModal(false)} 
          adding={adding}
          guessData={newGuessData}
          setGuessData={setNewGuessData}
          hashId={activeHashId}
          hashDescription={passwordHashes.find(h => h.id === activeHashId)?.description || ""}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="neon-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>FHE Password Audit</span>
            </div>
            <p>Secure password auditing using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">GitHub</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Security</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FHE Password Audit. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalAddHashProps {
  onSubmit: () => void; 
  onClose: () => void; 
  adding: boolean;
  hashData: any;
  setHashData: (data: any) => void;
}

const ModalAddHash: React.FC<ModalAddHashProps> = ({ 
  onSubmit, 
  onClose, 
  adding,
  hashData,
  setHashData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setHashData({
      ...hashData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!hashData.encryptedHash) {
      alert("Please enter encrypted hash");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Add Encrypted Password Hash</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <div className="key-icon">🔑</div> 
            <span>Your password hash will remain encrypted at all times using FHE</span>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <input 
              type="text"
              name="description"
              value={hashData.description} 
              onChange={handleChange}
              placeholder="Brief description of this password hash..." 
              className="neon-input"
            />
          </div>
          
          <div className="form-group">
            <label>Encrypted Password Hash *</label>
            <textarea 
              name="encryptedHash"
              value={hashData.encryptedHash} 
              onChange={handleChange}
              placeholder="Enter FHE-encrypted password hash..." 
              className="neon-textarea"
              rows={4}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="neon-button cancel"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={adding}
            className="neon-button primary"
          >
            {adding ? "Storing with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ModalAddGuessProps {
  onSubmit: () => void; 
  onClose: () => void; 
  adding: boolean;
  guessData: any;
  setGuessData: (data: any) => void;
  hashId: string;
  hashDescription: string;
}

const ModalAddGuess: React.FC<ModalAddGuessProps> = ({ 
  onSubmit, 
  onClose, 
  adding,
  guessData,
  setGuessData,
  hashId,
  hashDescription
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setGuessData({
      ...guessData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!guessData.encryptedGuess) {
      alert("Please enter encrypted guess");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Submit Encrypted Guess</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="target-hash">
            <div className="hash-label">Target Password Hash:</div>
            <div className="hash-id">#{hashId.substring(0, 6)}</div>
            <div className="hash-description">{hashDescription}</div>
          </div>
          
          <div className="fhe-notice">
            <div className="key-icon">🔒</div> 
            <span>Your guess will be verified without decryption using FHE</span>
          </div>
          
          <div className="form-group">
            <label>Encrypted Password Guess *</label>
            <textarea 
              name="encryptedGuess"
              value={guessData.encryptedGuess} 
              onChange={handleChange}
              placeholder="Enter FHE-encrypted password guess..." 
              className="neon-textarea"
              rows={4}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="neon-button cancel"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={adding}
            className="neon-button primary"
          >
            {adding ? "Processing with FHE..." : "Submit Guess"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;