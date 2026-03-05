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

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>
        <div className="webview-header">
          <h1>{initialState.title}</h1>
          {initialState.backlogUrl && (
            <a
              href="#"
              className="external-link"
              onClick={(e) => {
                e.preventDefault();
                const vscode = (window as any).acquireVsCodeApi();
                vscode.postMessage({ command: 'openExternal', url: initialState.backlogUrl });
              }}
            >
              Open in Backlog
            </a>
          )}
        </div>
        <div className="content-section">
          <div
            className="content-body"
            dangerouslySetInnerHTML={{ __html: initialState.content }}
          />
        </div>
      </div>
      <div id="claudeChatSection" className="claude-chat-section">
        <PanelResizer targetId="claudeChatSection" />
        <ClaudeChat />
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
