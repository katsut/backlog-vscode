import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { ClaudeChat } from '../components/ClaudeChat';
import { PanelResizer } from '../components/PanelResizer';
import { TodoHeader } from '../components/TodoHeader';
import { TodoContent } from '../components/TodoContent';
import { getVSCodeAPI } from '../hooks/useVSCodeMessage';
import { WorkspaceTodoItem, TodoStatus } from '../../types/workspace';
import { DraftInfo } from '../todoWebview';

interface InitialState {
  todo: WorkspaceTodoItem;
  baseUrl?: string;
  slackContextBefore?: any[];
  slackContextAfter?: any[];
  draft?: DraftInfo | null;
  fullContext?: string;
}

const TodoView: React.FC = () => {
  const initialState = (window as any).__INITIAL_STATE__ as InitialState;
  const [todo, setTodo] = useState<WorkspaceTodoItem>(initialState.todo);
  const [draft, setDraft] = useState<DraftInfo | null>(initialState.draft || null);
  const vscode = getVSCodeAPI();

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.command === 'updateStatus') {
        setTodo((prev) => ({ ...prev, status: msg.status }));
      }
      if (msg.command === 'updateReplied') {
        setTodo((prev) => ({ ...prev, replied: true }));
      }
      if (msg.command === 'updateDraft') {
        setDraft((prev) => ({ ...prev!, content: msg.draft }));
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);

  const handleStatusChange = (status: TodoStatus) => {
    vscode.postMessage({ command: 'setStatus', status });
  };

  const handleDelete = () => {
    if (confirm('このTODOを削除しますか？')) {
      vscode.postMessage({ command: 'delete' });
    }
  };

  const handleSaveNotes = (notes: string) => {
    vscode.postMessage({ command: 'saveNotes', notes });
  };

  const handleSaveDraft = (content: string) => {
    vscode.postMessage({ command: 'saveDraft', content });
  };

  const handlePostDraft = () => {
    vscode.postMessage({ command: 'postDraft' });
  };

  const handleDiscardDraft = () => {
    vscode.postMessage({ command: 'discardDraft' });
  };

  const handleRefreshDraft = () => {
    vscode.postMessage({ command: 'refreshDraft' });
  };

  const handleOpenExternal = (url: string) => {
    vscode.postMessage({ command: 'openExternal', url });
  };

  const handleOpenSlackThread = () => {
    vscode.postMessage({ command: 'openSlackThread' });
  };

  const handleStartClaude = () => {
    vscode.postMessage({ command: 'startClaudeSession' });
  };

  return (
    <div className="editor-wrapper">
      <TodoHeader
        todo={todo}
        baseUrl={initialState.baseUrl}
        onStatusChange={handleStatusChange}
        onDelete={handleDelete}
        onOpenExternal={handleOpenExternal}
      />
      <div className="page-layout">
        <div className="main-content">
          <TodoContent
            todo={todo}
            baseUrl={initialState.baseUrl}
            slackContextBefore={initialState.slackContextBefore}
            slackContextAfter={initialState.slackContextAfter}
            draft={draft}
            fullContext={initialState.fullContext}
            onSaveNotes={handleSaveNotes}
            onSaveDraft={handleSaveDraft}
            onPostDraft={handlePostDraft}
            onDiscardDraft={handleDiscardDraft}
            onRefreshDraft={handleRefreshDraft}
            onOpenExternal={handleOpenExternal}
            onOpenSlackThread={handleOpenSlackThread}
            onStartClaude={handleStartClaude}
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
  root.render(<TodoView />);
}
