import React, { useState } from 'react';
import { WorkspaceTodoItem, SlackMessage } from '../../types/workspace';
import { DraftInfo } from '../todoWebview';
import { BacklogContext, BacklogCommentHistory } from './BacklogContext';
import { SlackContext } from './SlackContext';
import { GoogleContext } from './GoogleContext';

interface TodoContentProps {
  todo: WorkspaceTodoItem;
  baseUrl?: string;
  slackContextBefore?: SlackMessage[];
  slackContextAfter?: SlackMessage[];
  draft?: DraftInfo | null;
  fullContext?: string;
  onSaveNotes: (notes: string) => void;
  onSaveDraft: (content: string) => void;
  onPostDraft: () => void;
  onDiscardDraft: () => void;
  onRefreshDraft: () => void;
  onOpenExternal: (url: string) => void;
  onOpenSlackThread: () => void;
}

export const TodoContent: React.FC<TodoContentProps> = ({
  todo,
  baseUrl,
  slackContextBefore,
  slackContextAfter,
  draft,
  fullContext,
  onSaveNotes,
  onSaveDraft,
  onPostDraft,
  onDiscardDraft,
  onRefreshDraft,
  onOpenExternal,
  onOpenSlackThread,
}) => {
  const [notesValue, setNotesValue] = useState(todo.notes || '');
  const [draftValue, setDraftValue] = useState(draft?.content || '');

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
        onOpenSlackThread={onOpenSlackThread}
      />
      <GoogleContext todo={todo} fullContext={fullContext} onOpenExternal={onOpenExternal} />

      {/* Draft section */}
      <div className="content-section draft-section">
        <div className="draft-header">
          <h3>{heading}</h3>
          {isPosted && <span className="status-badge done">投稿済</span>}
          {!isPosted && draft && (
            <button className="action-btn secondary small" onClick={onRefreshDraft}>
              ↻ 更新
            </button>
          )}
        </div>
        <textarea
          className="draft-content"
          placeholder="ドラフトを入力..."
          readOnly={isPosted}
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
        />
        {!isPosted && (
          <div className="draft-actions">
            <button className="action-btn secondary small" onClick={() => onSaveDraft(draftValue)}>
              保存
            </button>
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
          onChange={(e) => setNotesValue(e.target.value)}
        />
        <button className="action-btn secondary" onClick={() => onSaveNotes(notesValue)}>
          保存
        </button>
      </div>
    </div>
  );
};
