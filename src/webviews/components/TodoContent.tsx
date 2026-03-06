import React, { useState } from 'react';
import { WorkspaceTodoItem, SlackMessage, ActionItem } from '../../types/workspace';
import { DraftInfo } from '../todoWebview';
import { BacklogContext, BacklogCommentHistory } from './BacklogContext';
import { SlackContext } from './SlackContext';
import { GoogleContext } from './GoogleContext';
import { ActionItems } from './ActionItems';

interface TodoContentProps {
  todo: WorkspaceTodoItem;
  baseUrl?: string;
  slackContextBefore?: SlackMessage[];
  slackContextAfter?: SlackMessage[];
  draft?: DraftInfo | null;
  fullContext?: string;
  actions: ActionItem[];
  onSaveNotes: (notes: string) => void;
  onSaveDraft: (content: string) => void;
  onPostDraft: () => void;
  onDiscardDraft: () => void;
  onOpenExternal: (url: string) => void;
  onUpdateAction: (action: ActionItem) => void;
  onDeleteAction: (actionId: string) => void;
  onPostAction: (action: ActionItem) => void;
}

export const TodoContent: React.FC<TodoContentProps> = ({
  todo,
  baseUrl,
  slackContextBefore,
  slackContextAfter,
  draft,
  fullContext,
  actions,
  onSaveNotes,
  onSaveDraft,
  onPostDraft,
  onDiscardDraft,
  onOpenExternal,
  onUpdateAction,
  onDeleteAction,
  onPostAction,
}) => {
  const [notesValue, setNotesValue] = useState(todo.notes || '');
  const [draftValue, setDraftValue] = useState(draft?.content || '');

  // Auto-save draft on change
  const handleDraftChange = (value: string) => {
    setDraftValue(value);
    onSaveDraft(value);
  };

  // Auto-save notes on change
  const handleNotesChange = (value: string) => {
    setNotesValue(value);
    onSaveNotes(value);
  };

  const isPosted = draft?.status === 'posted';
  const action = draft?.action || 'none';
  const postLabel =
    action === 'slack-reply'
      ? 'Slack に返信'
      : action === 'investigate'
      ? 'アクション確認'
      : 'Backlog にコメント投稿';
  const heading = action === 'investigate' ? 'アクション整理' : '返信ドラフト';

  return (
    <div className="todo-main-content">
      {/* Context-specific rendering */}
      <BacklogContext
        todo={todo}
        baseUrl={baseUrl}
        fullContext={fullContext}
        onOpenExternal={onOpenExternal}
      />
      <SlackContext
        todo={todo}
        slackContextBefore={slackContextBefore}
        slackContextAfter={slackContextAfter}
      />
      <GoogleContext todo={todo} fullContext={fullContext} onOpenExternal={onOpenExternal} />

      {/* Action Items */}
      <ActionItems
        actions={actions}
        onUpdateAction={onUpdateAction}
        onDeleteAction={onDeleteAction}
        onPostAction={onPostAction}
      />

      {/* Draft section */}
      <div className="content-section draft-section">
        <div className="draft-header">
          <h3>{heading}</h3>
          {isPosted && <span className="status-badge done">投稿済</span>}
        </div>
        <textarea
          className="draft-content"
          placeholder="ドラフトを入力..."
          readOnly={isPosted}
          value={draftValue}
          onChange={(e) => handleDraftChange(e.target.value)}
        />
        {!isPosted && (
          <div className="draft-actions">
            {action !== 'investigate' && action !== 'none' && (
              <button className="action-btn post-btn" onClick={onPostDraft}>
                {postLabel}
              </button>
            )}
            {draft && (
              <button className="action-btn danger-btn small" onClick={onDiscardDraft}>
                破棄
              </button>
            )}
          </div>
        )}
      </div>

      {/* Comment history (for Backlog) - rendered after draft */}
      {todo.context?.source === 'backlog-notification' && (
        <BacklogCommentHistory fullContext={fullContext} />
      )}

      {/* Notes section */}
      <div className="content-section">
        <h3>Notes</h3>
        <textarea
          placeholder="メモを追加..."
          value={notesValue}
          onChange={(e) => handleNotesChange(e.target.value)}
        />
      </div>
    </div>
  );
};
