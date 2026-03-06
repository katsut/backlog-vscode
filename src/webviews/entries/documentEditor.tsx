import React, { useState } from 'react';
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

  const handleCopyAndOpen = () => {
    vscode.postMessage({ command: 'copyAndOpen', content });
  };

  return (
    <div className="editor-wrapper">
      <div className="webview-header">
        <div className="header-row">
          <h1>{initialState.title}</h1>
          <div className="header-actions">
            <button className="action-btn secondary" onClick={handleSave} disabled={isSaving}>
              {isSaving ? '保存中...' : '保存'}
            </button>
            <button className="action-btn secondary" onClick={handleCopyAndOpen}>
              Copy &amp; Open
            </button>
          </div>
        </div>
      </div>
      <div className="page-layout">
        <div className="main-content" style={{ display: 'flex', flexDirection: 'column' }}>
          <textarea
            className="document-editor-textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>
        <PanelResizer targetId="claudeChatSection" />
        <div id="claudeChatSection" className="claude-chat-section">
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
