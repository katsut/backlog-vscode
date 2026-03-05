import React from 'react';
import { WorkspaceTodoItem, TodoStatus } from '../../types/workspace';

interface TodoHeaderProps {
  todo: WorkspaceTodoItem;
  onStatusChange: (status: TodoStatus) => void;
  onDelete: () => void;
}

const STATUS_LABELS: Record<TodoStatus, string> = {
  open: '○ 未着手',
  in_progress: '◉ 進行中',
  waiting: '◷ 待ち',
  done: '✓ 完了',
};

const SOURCE_LABELS: Record<string, string> = {
  'backlog-notification': 'Backlog',
  'slack-mention': 'Slack',
  'slack-search': 'Slack',
  'google-doc': 'Google Docs',
  manual: '手動',
};

export const TodoHeader: React.FC<TodoHeaderProps> = ({ todo, onStatusChange, onDelete }) => {
  const statusLabel = STATUS_LABELS[todo.status] || todo.status;
  const sourceLabel = todo.context ? SOURCE_LABELS[todo.context.source] || todo.context.source : '';

  return (
    <div className="webview-header todo-header">
      <div className="todo-title-row">
        <h2 className="todo-title">{todo.text}</h2>
        <div className="header-actions">
          <select
            className="status-select"
            value={todo.status}
            onChange={(e) => onStatusChange(e.target.value as TodoStatus)}
          >
            <option value="open">{STATUS_LABELS.open}</option>
            <option value="in_progress">{STATUS_LABELS.in_progress}</option>
            <option value="waiting">{STATUS_LABELS.waiting}</option>
            <option value="done">{STATUS_LABELS.done}</option>
          </select>
          <button className="delete-btn" onClick={onDelete} title="Delete TODO">
            🗑
          </button>
        </div>
      </div>
      <div className="todo-meta-row">
        <span className={`status-badge ${todo.status}`}>{statusLabel}</span>
        {sourceLabel && <span className="meta-item">{sourceLabel}</span>}
        {todo.replied && <span className="meta-item replied-badge">返信済</span>}
      </div>
    </div>
  );
};
