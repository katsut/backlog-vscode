import React, { useState, useRef, useEffect } from 'react';
import { useVSCodeMessage } from '../hooks/useVSCodeMessage';

interface ChatMessage {
  role: 'user' | 'assistant' | 'error';
  text: string;
}

export const ClaudeChat: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem('claudeChatModel') || 'claude-sonnet-4-6'
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const currentAssistantRef = useRef<number | null>(null);

  const postMessage = useVSCodeMessage((msg: any) => {
    switch (msg.command) {
      case 'chatTurnStart':
        setMessages((prev) => {
          currentAssistantRef.current = prev.length;
          return [...prev, { role: 'assistant', text: '' }];
        });
        setIsProcessing(true);
        break;
      case 'chatChunk':
        setMessages((prev) => {
          if (currentAssistantRef.current === null) return prev;
          const newMessages = [...prev];
          newMessages[currentAssistantRef.current] = { role: 'assistant', text: msg.text };
          return newMessages;
        });
        break;
      case 'chatDone':
        currentAssistantRef.current = null;
        setIsProcessing(false);
        inputRef.current?.focus();
        break;
      case 'chatError':
        setMessages((prev) => {
          if (currentAssistantRef.current !== null) {
            const newMessages = [...prev];
            newMessages[currentAssistantRef.current] = { role: 'error', text: `Error: ${msg.text}` };
            return newMessages;
          }
          return [...prev, { role: 'error', text: `Error: ${msg.text}` }];
        });
        currentAssistantRef.current = null;
        setIsProcessing(false);
        break;
    }
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text || isProcessing) return;

    setMessages((prev) => [...prev, { role: 'user', text }]);
    setInputValue('');
    console.log('[ClaudeChat] sending sendChatMessage', { text, model: selectedModel });
    postMessage('sendChatMessage', { text, model: selectedModel || undefined });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  const handleStop = () => {
    postMessage('stopClaude');
  };

  return (
    <>
      <div className="claude-chat-header">
        <h3>✦ Claude Code</h3>
        <div className="header-actions">
          <select
            className="model-select"
            value={selectedModel}
            onChange={(e) => {
              setSelectedModel(e.target.value);
              localStorage.setItem('claudeChatModel', e.target.value);
            }}
            title="モデル選択"
          >
            <option value="claude-opus-4-6">Opus</option>
            <option value="claude-sonnet-4-6">Sonnet</option>
            <option value="claude-haiku-4-5-20251001">Haiku</option>
          </select>
          {isProcessing && (
            <button className="claude-stop-btn" onClick={handleStop}>
              停止
            </button>
          )}
        </div>
      </div>
      <div className="chat-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`chat-msg ${msg.role}`}>
            {msg.role === 'assistant' ? msg.text.replace(/^\n+/, '') : msg.text}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="chat-input-row">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="メッセージを入力... (Cmd+Enter で送信)"
          rows={2}
          disabled={isProcessing}
        />
        <button className="chat-send-btn" onClick={handleSend} disabled={isProcessing || !inputValue.trim()}>
          送信
        </button>
      </div>
    </>
  );
};
