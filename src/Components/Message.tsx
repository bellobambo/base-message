import React, { useState } from "react";
import { ethers } from "ethers";
import { Client, type Signer, type Identifier } from "@xmtp/browser-sdk";

declare global {
  interface Window {
    ethereum?: any;
  }
}

interface Contact {
  identity: string;
  inboxId: string;
}

const Message = () => {
  const [accountIdentifier, setAccountIdentifier] = useState<Identifier | null>(
    null
  );
  const [signer, setSigner] = useState<Signer | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [newContactAddress, setNewContactAddress] = useState("");
  const [activeConversation, setActiveConversation] = useState<any>(null);
  const [messageContent, setMessageContent] = useState("");
  const [conversationMessages, setConversationMessages] = useState<any[]>([]);

  const connectWallet = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!window.ethereum) {
        throw new Error("Ethereum provider not detected");
      }

      const provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await provider.send("eth_requestAccounts", []);

      if (!accounts.length) {
        throw new Error("No accounts found");
      }

      const address = accounts[0];
      const newAccountIdentifier: Identifier = {
        identifier: address,
        identifierKind: "Ethereum",
      };
      setAccountIdentifier(newAccountIdentifier);

      const walletSigner = await provider.getSigner();
      const xmtpSigner: Signer = {
        type: "EOA",
        getIdentifier: () => newAccountIdentifier,
        signMessage: async (message: string) => {
          const signature = await walletSigner.signMessage(message);
          return ethers.getBytes(signature);
        },
      };
      setSigner(xmtpSigner);

      // Initialize XMTP client with proper error handling
      try {
        // First try to build (resume) existing client
        const xmtpClient = await Client.build(newAccountIdentifier, {
          env: "dev",
          //   signer: xmtpSigner,
          // Skip loading old messages if they cause issues
          //   skipContactPublishing: true,
          //   persistConversations: false,
        });
        setClient(xmtpClient);
        console.log("Resumed existing XMTP client");
      } catch (buildError) {
        console.warn("Could not resume client, creating new one:", buildError);
        const newClient = await Client.create(xmtpSigner, {
          env: "dev",
          //   skipContactPublishing: true,
          // Optional: Add persistence after successful creation
          // persistConversations: true
        });
        setClient(newClient);
        console.log("Created new XMTP client");
      }
    } catch (err) {
      console.error("Initialization error:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
      // Clear any potentially corrupted client states
      setClient(null);
    } finally {
      setLoading(false);
    }
  };

  const isValidEthereumAddress = (address: string) => {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  };

  const checkContactReachability = async (address: string) => {
    if (!client) return false;
    try {
      const identifier: Identifier = {
        identifier: address,
        identifierKind: "Ethereum",
      };
      const response: any = await Client.canMessage([identifier]);
      return response.get(identifier) === true;
    } catch (error) {
      console.error("Error checking reachability:", error);
      return false;
    }
  };

  const addContact = async () => {
    if (!newContactAddress.trim()) return;

    if (!isValidEthereumAddress(newContactAddress)) {
      alert("Please enter a valid Ethereum address");
      return;
    }

    const isReachable = await checkContactReachability(newContactAddress);
    if (!isReachable) {
      alert("This address is not reachable on XMTP");
      return;
    }

    const newContact: Contact = {
      identity: newContactAddress,
      inboxId: newContactAddress,
    };

    setContacts([...contacts, newContact]);
    setNewContactAddress("");
  };

  const createNewDM = async (contact: Contact) => {
    if (!client) return;
    try {
      const conversation = await client.conversations.newDm(contact.inboxId);
      setActiveConversation(conversation);
      loadMessages(conversation);
    } catch (error) {
      console.error("Error creating new DM:", error);
    }
  };

  const createNewGroup = async () => {
    if (!client || contacts.length < 2) return;
    try {
      const inboxIds = contacts.map((contact) => contact.inboxId);
      const group = await client.conversations.newGroup(inboxIds);
      setActiveConversation(group);
      loadMessages(group);
    } catch (error) {
      console.error("Error creating groups:", error);
    }
  };

  const sendMessage = async () => {
    if (!activeConversation || !messageContent.trim()) return;
    try {
      await activeConversation.send(messageContent);
      setMessageContent("");
      loadMessages(activeConversation);
    } catch (error) {
      console.error("Error sending message:", error);
    }
  };

  const loadMessages = async (conversation: any) => {
    if (!conversation) return;
    try {
      const messages = await conversation.messages();
      setConversationMessages(messages);
    } catch (error) {
      console.error("Error loading messages:", error);
    }
  };

  if (!accountIdentifier || !signer || !client) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          flexDirection: "column",
        }}
      >
        {loading ? (
          <div>Connecting wallet and initializing XMTP client...</div>
        ) : error ? (
          <div style={{ color: "red", marginBottom: "16px" }}>
            Error: {error}
          </div>
        ) : null}
        <button onClick={connectWallet} disabled={loading}>
          {loading ? "Connecting..." : "Connect Wallet"}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* Sidebar */}
      <div
        style={{
          width: "300px",
          borderRight: "1px solid #ccc",
          padding: "16px",
        }}
      >
        {/* Display connected wallet */}
        <div
          style={{
            marginBottom: "16px",
            padding: "8px",
            backgroundColor: "#f0f0f0",
            borderRadius: "4px",
            wordBreak: "break-all",
          }}
        >
          <div
            style={{ fontWeight: "bold", marginBottom: "4px", color: "black" }}
          >
            Connected Wallet:
          </div>
          <div style={{ color: "black" }}>{accountIdentifier.identifier}</div>
        </div>

        <h2>Contacts</h2>
        <div style={{ marginBottom: "16px" }}>
          <input
            type="text"
            value={newContactAddress}
            onChange={(e) => setNewContactAddress(e.target.value)}
            placeholder="Enter Ethereum address"
            style={{ width: "100%", padding: "8px" }}
          />
          <button
            onClick={addContact}
            style={{ marginTop: "8px", width: "100%" }}
          >
            Add Contact
          </button>
        </div>

        {contacts.length >= 2 && (
          <button
            onClick={createNewGroup}
            style={{ marginBottom: "16px", width: "100%" }}
          >
            Create Group with Selected
          </button>
        )}

        <ul style={{ listStyle: "none", padding: 0 }}>
          {contacts.map((contact, index) => (
            <li
              key={index}
              onClick={() => createNewDM(contact)}
              style={{
                padding: "8px",
                cursor: "pointer",
                backgroundColor:
                  activeConversation?.peerAddress === contact.inboxId
                    ? "#f0f0f0"
                    : "transparent",
              }}
            >
              {contact.identity}
            </li>
          ))}
        </ul>
      </div>

      {/* Conversation area */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        {activeConversation ? (
          <>
            <div style={{ padding: "16px", borderBottom: "1px solid #ccc" }}>
              <h3>
                {activeConversation.isGroup
                  ? `Group Chat (${
                      activeConversation.peerAddresses?.length || 0
                    } members)`
                  : `DM with ${activeConversation.peerAddress}`}
              </h3>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
              {conversationMessages.map((message, index) => (
                <div key={index} style={{ marginBottom: "8px" }}>
                  <strong>{message.senderAddress}: </strong>
                  <span>{message.content}</span>
                </div>
              ))}
            </div>

            <div style={{ padding: "16px", borderTop: "1px solid #ccc" }}>
              <textarea
                value={messageContent}
                onChange={(e) => setMessageContent(e.target.value)}
                placeholder="Type your message..."
                style={{ width: "100%", minHeight: "60px", padding: "8px" }}
              />
              <button onClick={sendMessage} style={{ marginTop: "8px" }}>
                Send
              </button>
            </div>
          </>
        ) : (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
            }}
          >
            <p>Select a contact or create a group to start chatting</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Message;
