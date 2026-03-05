import React, { useState } from 'react';
import { WorkspaceTodoItem, SlackMessage } from '../../types/workspace';
import { DraftInfo } from '../todoWebview';

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
  onStartClaude: () => void;
}

export const TodoContent: React.FC<TodoContentProps> = ({
  todo,
  baseUrl,
  draft,
  fullContext,
  onSaveNotes,
  onSaveDraft,
  onPostDraft,
  onDiscardDraft,
  onRefreshDraft,
  onOpenExternal,
  onOpenSlackThread,
  onStartClaude,
}) => {
  const [notesValue, setNotesValue] = useState(todo.notes || '');
  const [draftValue, setDraftValue] = useState(draft?.content || '');

  const ctx = todo.context;

  // Build source link
  let sourceLink = null;
  const fullBaseUrl = baseUrl
    ? baseUrl.startsWith('http')
      ? baseUrl
      : `https://${baseUrl}`
    : '';

  if (ctx?.source === 'backlog-notification' && ctx.issueKey && fullBaseUrl) {
    const issueUrl = `${fullBaseUrl}/view/${ctx.issueKey}`;
    sourceLink = (
      <a href="#" onClick={(e) => { e.preventDefault(); onOpenExternal(issueUrl); }}>
        Open in Backlog
      </a>
    );
  } else if (
    (ctx?.source === 'slack-mention' || ctx?.source === 'slack-search') &&
    ctx?.slackChannel
  ) {
    sourceLink = (
      <a href="#" onClick={(e) => { e.preventDefault(); onOpenSlackThread(); }}>
        Open in Slack
      </a>
    );
  } else if (ctx?.source === 'google-doc' && ctx?.googleDocUrl) {
    sourceLink = (
      <a href="#" onClick={(e) => { e.preventDefault(); onOpenExternal(ctx.googleDocUrl!); }}>
        Open in Google Docs
      </a>
    );
  }

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
      {sourceLink && (
        <div className="content-section">
          <div className="source-link-section">{sourceLink}</div>
        </div>
      )}

      {fullContext && (
        <div className="content-section">
          <div className="full-context" dangerouslySetInnerHTML={{ __html: fullContext }} />
        </div>
      )}

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

      <div className="content-section">
        <button className="action-btn primary" onClick={onStartClaude}>
          ✦ Claude で対応
        </button>
      </div>
    </div>
  );
};
