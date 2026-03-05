import React from 'react';
import { WorkspaceTodoItem, TodoStatus } from '../../types/workspace';

interface TodoHeaderProps {
  todo: WorkspaceTodoItem;
  baseUrl?: string;
  onStatusChange: (status: TodoStatus) => void;
  onDelete: () => void;
  onOpenExternal?: (url: string) => void;
}

const STATUSES: Array<{ status: TodoStatus; label: string; icon: string }> = [
  { status: 'open', label: '未着手', icon: '○' },
  { status: 'in_progress', label: '進行中', icon: '◉' },
  { status: 'waiting', label: '待ち', icon: '◷' },
  { status: 'done', label: '完了', icon: '✓' },
];

const SOURCE_LABELS: Record<string, string> = {
  'backlog-notification': 'Backlog',
  'slack-mention': 'Slack',
  'slack-search': 'Slack',
  'google-doc': 'Google Docs',
  manual: '手動',
};

const SOURCE_CLASSES: Record<string, string> = {
  'backlog-notification': 'source-backlog',
  'slack-mention': 'source-slack',
  'slack-search': 'source-slack',
  'google-doc': 'source-calendar',
  manual: 'source-manual',
};

export const TodoHeader: React.FC<TodoHeaderProps> = ({
  todo,
  baseUrl,
  onStatusChange,
  onDelete,
  onOpenExternal
}) => {
  const ctx = todo.context;
  const sourceLabel = ctx ? SOURCE_LABELS[ctx.source] || ctx.source : '';
  const sourceClass = ctx ? SOURCE_CLASSES[ctx.source] || '' : '';

  // Build external link for Backlog
  const fullBaseUrl = baseUrl
    ? baseUrl.startsWith('http')
      ? baseUrl
      : `https://${baseUrl}`
    : '';
  const externalUrl =
    ctx?.source === 'backlog-notification' && ctx.issueKey && fullBaseUrl
      ? `${fullBaseUrl}/view/${ctx.issueKey}`
      : ctx?.googleDocUrl || null;

  return (
    <div className="webview-header todo-header">
      <div className="todo-title-row">
        {sourceLabel && (
          <span className={`meta-item ${sourceClass}`}>{sourceLabel}</span>
        )}
        <h2 className="todo-title">{todo.text}</h2>
        {externalUrl && onOpenExternal && (
          <a
            href="#"
            className={`external-link ${
              ctx?.source === 'backlog-notification' ? 'link-backlog' : 'link-calendar'
            }`}
            onClick={(e) => {
              e.preventDefault();
              onOpenExternal(externalUrl);
            }}
          >
            {ctx?.source === 'backlog-notification' ? 'Open in Backlog' : 'Open in Docs'}
          </a>
        )}
      </div>
      <div className="todo-controls-row">
        <div className="status-actions">
          {STATUSES.map((s) => (
            <button
              key={s.status}
              className={`status-btn ${s.status === todo.status ? 'active' : ''}`}
              onClick={() => onStatusChange(s.status)}
            >
              {s.icon} {s.label}
            </button>
          ))}
          <button className="action-btn danger-btn small" onClick={onDelete}>
            削除
          </button>
        </div>
      </div>
    </div>
  );
};
