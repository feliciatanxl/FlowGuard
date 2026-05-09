import React, { useState, useEffect, useRef } from 'react';
import '../css/AIChatPopup.css';

const AIChatPopup = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([
    { role: 'ai', text: "Systems online. I am FlowGuard AI. How can I assist with facility monitoring today?" }
  ]);
  
  const chatEndRef = useRef(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;

    // Add user message
    const newMessages = [...messages, { role: 'user', text: input }];
    setMessages(newMessages);
    setInput('');

    // Mock AI Response (This is where you'd call your AI API later)
    setTimeout(() => {
      setMessages(prev => [...prev, { 
        role: 'ai', 
        text: "Analyzing site documentation... I've noted your request regarding " + input + ". How else can I help?" 
      }]);
    }, 1000);
  };

  return (
    <div className={`chat-popup-wrapper ${isOpen ? 'chat-open' : ''}`}>
      {/* Floating Action Button */}
      <button className="chat-fab" onClick={() => setIsOpen(!isOpen)}>
        {isOpen ? '✕' : '🤖'}
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div className="chat-window">
          <div className="chat-header">
            <div className="ai-status-dot"></div>
            <h3>FlowGuard AI Assistant</h3>
          </div>
          
          <div className="chat-messages">
            {messages.map((msg, index) => (
              <div key={index} className={`message-bubble ${msg.role}-bubble`}>
                {msg.text}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          <div className="chat-input-area">
            <input 
              type="text" 
              placeholder="Ask about site protocols..." 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            />
            <button onClick={handleSend}>Send</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AIChatPopup;