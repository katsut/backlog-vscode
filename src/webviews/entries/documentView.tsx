import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ClaudeChat } from '../components/ClaudeChat';
import { PanelResizer } from '../components/PanelResizer';
import { getVSCodeAPI } from '../hooks/useVSCodeMessage';

interface InitialState {
  title: string;
  content: string;
  backlogUrl?: string;
  documentId?: string;
}

type ViewMode = 'preview' | 'source';

const DocumentView: React.FC = () => {
  const initialState = (window as any).__INITIAL_STATE__ as InitialState;
  const vscode = getVSCodeAPI();
  const [mode, setMode] = useState<ViewMode>('preview');

  const handleOpenExternal = () => {
    if (initialState.backlogUrl) {
      vscode.postMessage({ command: 'openExternal', url: initialState.backlogUrl });
    }
  };

  const handleModeSwitch = (newMode: string) => {
    if (newMode === 'edit' || newMode === 'diff' || newMode === 'pull' || newMode === 'copyOpen') {
      vscode.postMessage({ command: 'switchMode', mode: newMode, documentId: initialState.documentId });
    } else if (newMode === 'preview' || newMode === 'source') {
      setMode(newMode as ViewMode);
    }
  };

  return (
    <div className="editor-wrapper">
      <div className="webview-header">
        <div className="mode-toolbar">
          <div className="mode-tabs">
            <button
              className="mode-tab"
              onClick={() => handleModeSwitch('edit')}
              title="Edit document"
            >
              Edit
            </button>
            <button
              className={`mode-tab ${mode === 'preview' ? 'active' : ''}`}
              onClick={() => handleModeSwitch('preview')}
              title="Preview document"
            >
              Preview
            </button>
            <button
              className={`mode-tab ${mode === 'source' ? 'active' : ''}`}
              onClick={() => handleModeSwitch('source')}
              title="View source"
            >
              Source
            </button>
            <button
              className="mode-tab"
              onClick={() => handleModeSwitch('diff')}
              title="Diff with remote"
            >
              Diff
            </button>
          </div>
          <div className="mode-actions">
            <button
              className="mode-action-btn"
              onClick={() => handleModeSwitch('pull')}
              title="Pull from Backlog"
            >
              Pull
            </button>
            <button
              className="mode-action-btn"
              onClick={() => handleModeSwitch('copyOpen')}
              title="Copy to clipboard & open in Backlog"
            >
              Copy&Open
            </button>
          </div>
        </div>
        <h1>{initialState.title}</h1>
        {initialState.backlogUrl && (
          <a
            href="#"
            className="external-link link-backlog"
            onClick={(e) => {
              e.preventDefault();
              handleOpenExternal();
            }}
          >
            Open in Backlog
          </a>
        )}
      </div>
      <div className="page-layout">
        <div className="main-content">
          <div className="content-section">
            {mode === 'preview' ? (
              <div
                className="content-body markdown-content"
                dangerouslySetInnerHTML={{ __html: initialState.content }}
              />
            ) : (
              <pre className="plain-text-content">{initialState.content.replace(/<[^>]+>/g, '')}</pre>
            )}
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
