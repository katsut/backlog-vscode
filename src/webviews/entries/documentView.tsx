import React from 'react';
import { createRoot } from 'react-dom/client';
import { ClaudeChat } from '../components/ClaudeChat';
import { PanelResizer } from '../components/PanelResizer';

interface InitialState {
  title: string;
  content: string;
  backlogUrl?: string;
}

const DocumentView: React.FC = () => {
  const initialState = (window as any).__INITIAL_STATE__ as InitialState;

  const handleOpenExternal = () => {
    if (initialState.backlogUrl) {
      const vscode = (window as any).acquireVsCodeApi();
      vscode.postMessage({ command: 'openExternal', url: initialState.backlogUrl });
    }
  };

  return (
    <div className="editor-wrapper">
      <div className="webview-header">
        <h1>{initialState.title}</h1>
        {initialState.backlogUrl && (
          <a href="#" className="external-link" onClick={(e) => { e.preventDefault(); handleOpenExternal(); }}>
            Open in Backlog
          </a>
        )}
      </div>
      <div className="page-layout">
        <div className="main-content">
          <div className="content-section">
            <div
              className="content-body"
              dangerouslySetInnerHTML={{ __html: initialState.content }}
            />
          </div>
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
  root.render(<DocumentView />);
}
