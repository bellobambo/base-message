import React, { useState, useEffect } from "react";
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

interface OptimisticMessage {
  id: string;
  content: string;
  senderAddress: string;
  status: "unpublished" | "published" | "failed";
  sentAt: Date;
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
  const [optimisticMessages, setOptimisticMessages] = useState<
    OptimisticMessage[]
  >([]);
  const [isSending, setIsSending] = useState(false);

  // Effect to listen for new messages
  useEffect(() => {
    if (!client || !activeConversation) return;

    const streamMessages = async () => {
      try {
        const stream = await activeConversation.streamMessages();
        for await (const message of stream) {
          // Check if this message is already in our state
          if (
            !conversationMessages.some((m) => m.id === message.id) &&
            !optimisticMessages.some((m) => m.id === message.id)
          ) {
            setConversationMessages((prev) => [...prev, message]);
          }
        }
      } catch (error) {
        console.error("Error streaming messages:", error);
      }
    };

    streamMessages();

    return () => {
      // Clean up the stream when component unmounts or conversation changes
      // Note: Actual cleanup depends on XMTP SDK implementation
    };
  }, [client, activeConversation, conversationMessages, optimisticMessages]);

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

      // Initialize XMTP client
      const xmtpClient = await Client.create(xmtpSigner, {
        env: "dev",
      });
      setClient(xmtpClient);
      console.log("XMTP client initialized successfully");
    } catch (err) {
      console.error("Initialization error:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
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
      return await client.canMessage([identifier]);
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

    const normalizedAddress = newContactAddress.toLowerCase();
    if (contacts.some((c) => c.identity.toLowerCase() === normalizedAddress)) {
      alert("Contact already exists");
      return;
    }

    try {
      setLoading(true);
      const isReachable = await checkContactReachability(newContactAddress);

      if (!isReachable) {
        alert(
          "This address is not reachable on XMTP. The user may need to activate their XMTP identity."
        );
        return;
      }

      const newContact: Contact = {
        identity: newContactAddress,
        inboxId: newContactAddress,
      };

      setContacts((prev) => [...prev, newContact]);
      setNewContactAddress("");

      // Automatically create and open DM with the new contact
      await createNewDM(newContact);
    } catch (error) {
      console.error("Error adding contact:", error);
      alert("Failed to add contact. Please try again.");
    } finally {
      setLoading(false);
    }
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
    if (!activeConversation || !messageContent.trim() || isSending) return;

    setIsSending(true);
    const tempId = `optimistic-${Date.now()}`;
    const optimisticMessage: OptimisticMessage = {
      id: tempId,
      content: messageContent,
      senderAddress: accountIdentifier?.identifier || "",
      status: "unpublished",
      sentAt: new Date(),
    };

    try {
      // 1. Optimistically add to UI immediately
      setOptimisticMessages((prev) => [...prev, optimisticMessage]);
      setMessageContent("");

      // 2. Actually send the message to the network
      await activeConversation.send(messageContent);

      // 3. Update status to published
      setOptimisticMessages((prev) =>
        prev.map((msg) =>
          msg.id === tempId ? { ...msg, status: "published" } : msg
        )
      );

      // 4. Refresh messages to get the actual message from the network
      await loadMessages(activeConversation);
    } catch (error) {
      console.error("Error sending message:", error);
      // Update status to failed
      setOptimisticMessages((prev) =>
        prev.map((msg) =>
          msg.id === tempId ? { ...msg, status: "failed" } : msg
        )
      );
    } finally {
      setIsSending(false);
    }
  };

  const loadMessages = async (conversation: any) => {
    if (!conversation) return;
    try {
      const messages = await conversation.messages();
      setConversationMessages(messages);

      // Remove optimistic messages that have been successfully published
      setOptimisticMessages((prev) =>
        prev.filter((msg) => msg.status !== "published")
      );
    } catch (error) {
      console.error("Error loading messages:", error);
    }
  };

  const retryFailedMessage = async (messageId: string) => {
    const failedMessage = optimisticMessages.find(
      (msg) => msg.id === messageId
    );
    if (!failedMessage || !activeConversation) return;

    setOptimisticMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId ? { ...msg, status: "unpublished" } : msg
      )
    );

    try {
      await activeConversation.send(failedMessage.content);
      setOptimisticMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, status: "published" } : msg
        )
      );
      await loadMessages(activeConversation);
    } catch (error) {
      console.error("Error retrying message:", error);
      setOptimisticMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, status: "failed" } : msg
        )
      );
    }
  };

  const cancelFailedMessage = (messageId: string) => {
    setOptimisticMessages((prev) => prev.filter((msg) => msg.id !== messageId));
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

  // Combine actual messages and optimistic messages for display
  const allMessages = [
    ...conversationMessages,
    ...optimisticMessages.map((msg) => ({
      id: msg.id,
      content: msg.content,
      senderAddress: msg.senderAddress,
      sent: msg.sentAt,
      status: msg.status,
    })),
  ].sort((a, b) => new Date(a.sent).getTime() - new Date(b.sent).getTime());

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
            disabled={loading}
          >
            {loading ? "Adding..." : "Add Contact"}
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
              {allMessages.length === 0 ? (
                <div style={{ textAlign: "center", marginTop: "20px" }}>
                  <p>No messages yet. Start the conversation!</p>
                </div>
              ) : (
                allMessages.map((message, index) => (
                  <div
                    key={message.id || index}
                    style={{
                      marginBottom: "8px",
                      opacity: message.status === "failed" ? 0.7 : 1,
                    }}
                  >
                    <strong>{message.senderAddress}: </strong>
                    <span>{message.content}</span>
                    {message.status === "unpublished" && (
                      <span style={{ marginLeft: "8px", color: "#888" }}>
                        (Sending...)
                      </span>
                    )}
                    {message.status === "failed" && (
                      <span style={{ marginLeft: "8px" }}>
                        <button
                          onClick={() => retryFailedMessage(message.id)}
                          style={{ marginRight: "4px" }}
                        >
                          Retry
                        </button>
                        <button onClick={() => cancelFailedMessage(message.id)}>
                          Cancel
                        </button>
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>

            <div style={{ padding: "16px", borderTop: "1px solid #ccc" }}>
              <textarea
                value={messageContent}
                onChange={(e) => setMessageContent(e.target.value)}
                placeholder="Type your message..."
                style={{ width: "100%", minHeight: "60px", padding: "8px" }}
                disabled={isSending}
                onKeyPress={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
              />
              <button
                onClick={sendMessage}
                style={{ marginTop: "8px" }}
                disabled={!messageContent.trim() || isSending}
              >
                {isSending ? "Sending..." : "Send"}
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
              flexDirection: "column",
            }}
          >
            <p>Select a contact or create a group to start chatting</p>
            {contacts.length > 0 && (
              <button
                onClick={() => createNewDM(contacts[0])}
                style={{ marginTop: "16px" }}
              >
                Start chatting with {contacts[0].identity}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Message;
