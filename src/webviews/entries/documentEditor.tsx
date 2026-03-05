import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ClaudeChat } from '../components/ClaudeChat';
import { PanelResizer } from '../components/PanelResizer';
import { getVSCodeAPI } from '../hooks/useVSCodeMessage';

interface InitialState {
  title: string;
  content: string;
  backlogUrl?: string;
}

const DocumentEditor: React.FC = () => {
  const initialState = (window as any).__INITIAL_STATE__ as InitialState;
  const [content, setContent] = useState(initialState.content);
  const [isSaving, setIsSaving] = useState(false);
  const vscode = getVSCodeAPI();

  const handleSave = () => {
    setIsSaving(true);
    vscode.postMessage({ command: 'save', content });
    setTimeout(() => setIsSaving(false), 500);
  };

  const handleOpenExternal = () => {
    if (initialState.backlogUrl) {
      vscode.postMessage({ command: 'openExternal', url: initialState.backlogUrl });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div className="webview-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1>{initialState.title}</h1>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className="action-btn secondary" onClick={handleSave} disabled={isSaving}>
              {isSaving ? '保存中...' : '保存'}
            </button>
            {initialState.backlogUrl && (
              <button className="action-btn secondary" onClick={handleOpenExternal}>
                Open in Backlog
              </button>
            )}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
          <textarea
            style={{
              width: '100%',
              minHeight: '500px',
              fontFamily: 'var(--webview-mono-font-family)',
              fontSize: '14px',
              lineHeight: '1.6',
            }}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>
        <div id="claudeChatSection" className="claude-chat-section">
          <PanelResizer targetId="claudeChatSection" />
          <ClaudeChat />
        </div>
      </div>
    </div>
  );
};

// Mount React app
const container = document.getElementById('reactRoot');
if (container) {
  const root = createRoot(container);
  root.render(<DocumentEditor />);
}
