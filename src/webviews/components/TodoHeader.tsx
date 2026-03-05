import React from 'react';
import { WorkspaceTodoItem, TodoStatus } from '../../types/workspace';

interface TodoHeaderProps {
  todo: WorkspaceTodoItem;
  onStatusChange: (status: TodoStatus) => void;
  onDelete: () => void;
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

export const TodoHeader: React.FC<TodoHeaderProps> = ({ todo, onStatusChange, onDelete }) => {
  const sourceLabel = todo.context ? SOURCE_LABELS[todo.context.source] || todo.context.source : '';
  const sourceClass = todo.context ? SOURCE_CLASSES[todo.context.source] || '' : '';

  return (
    <div className="webview-header todo-header">
      <div className="todo-title-row">
        <h2 className="todo-title">{todo.text}</h2>
      </div>
      <div className="todo-meta-row">
        {sourceLabel && (
          <span className={`meta-item ${sourceClass}`}>{sourceLabel}</span>
        )}
        {todo.replied && <span className="meta-item replied-badge">返信済</span>}
      </div>
      <div className="status-actions">
        <span className="status-actions-label">Status:</span>
        {STATUSES.map((s) => (
          <button
            key={s.status}
            className={`status-btn ${s.status === todo.status ? 'active' : ''}`}
            onClick={() => onStatusChange(s.status)}
          >
            {s.icon} {s.label}
          </button>
        ))}
        <button className="action-btn danger-btn" onClick={onDelete}>
          削除
        </button>
      </div>
    </div>
  );
};
