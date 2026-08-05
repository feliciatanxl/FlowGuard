import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import '../css/AIChatPopup.css';

// Stable session ID for this browser tab — resets when user closes the tab.
function getSessionId() {
  let id = sessionStorage.getItem('fg_chat_session');
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem('fg_chat_session', id);
  }
  return id;
}

const INITIAL_MESSAGE = {
  role: 'ai',
  text: 'Systems online. I am FlowGuard AI. How can I assist you with facility access or site protocols today?'
};

const AIChatPopup = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([INITIAL_MESSAGE]);
  const [loading, setLoading] = useState(false);
  const [escalated, setEscalated] = useState(false);
  const [ticketId, setTicketId] = useState(null);

  const chatEndRef = useRef(null);
  const sessionId = useRef(getSessionId());

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Rehydrate this session's history on mount — sessionId survives a page
  // refresh (it lives in sessionStorage), but before this the messages and
  // escalation banner didn't, so reloading mid-conversation looked like the
  // whole exchange had been forgotten even though the backend still had it.
  useEffect(() => {
    (async () => {
      try {
        const { data } = await axios.get(`/api/support/chat/${sessionId.current}`);
        if (data.messages?.length) {
          setMessages([INITIAL_MESSAGE, ...data.messages]);
        }
        if (data.escalated) {
          setEscalated(true);
          setTicketId(data.ticketId);
        }
      } catch {
        // No prior history, or a transient error — start fresh silently.
      }
    })();
  }, []);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', text }]);
    setLoading(true);

    try {
      const userId   = localStorage.getItem('userId')   || undefined;
      const tenantName = localStorage.getItem('userName') || undefined;
      const unitNumber = localStorage.getItem('unitNumber') || undefined;

      const { data } = await axios.post('/api/support/chat', {
        sessionId: sessionId.current,
        message: text,
        userId,
        tenantName,
        unitNumber
      });

      setMessages(prev => [...prev, { role: 'ai', text: data.response }]);

      if (data.escalated) {
        setEscalated(true);
        setTicketId(data.ticketId);
      }
    } catch (err) {
      console.error('Chat error:', err);
      setMessages(prev => [
        ...prev,
        { role: 'ai', text: 'I am temporarily unable to process your request. Please try again in a moment or contact the FM office directly.' }
      ]);
      // Restore the failed message into the input — it was never persisted
      // server-side, so the tenant shouldn't have to retype it from memory.
      setInput(text);
    } finally {
      setLoading(false);
    }
  };

  const handleOpen = () => {
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
  };

  return (
    <div className={`chat-popup-wrapper ${isOpen ? 'chat-open' : ''}`}>
      {/* Floating Action Button */}
      <button className="chat-fab" onClick={isOpen ? handleClose : handleOpen} aria-label="Toggle AI chat">
        {isOpen ? '✕' : '🤖'}
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div className="chat-window">
          <div className="chat-header">
            <div className="ai-status-dot"></div>
            <h3>FlowGuard AI Assistant</h3>
          </div>

          {escalated && ticketId && (
            <div className="chat-escalation-banner">
              Ticket #{ticketId} created — FM team notified
            </div>
          )}

          <div className="chat-messages" aria-live="polite">
            {messages.map((msg, i) => (
              <div key={i} className={`message-bubble ${msg.role}-bubble`}>
                {msg.text}
              </div>
            ))}
            {loading && (
              <div className="message-bubble ai-bubble chat-typing">
                <span></span><span></span><span></span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="chat-input-area">
            <input
              type="text"
              placeholder={escalated ? 'Add more details for the FM team...' : 'Ask about site protocols...'}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              disabled={loading}
            />
            <button onClick={handleSend} disabled={loading || !input.trim()}>
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AIChatPopup;
