import React, { useState } from 'react';
import { ActionItem, ActionItemType } from '../../types/workspace';

interface ActionItemsProps {
  actions: ActionItem[];
  onUpdateAction: (action: ActionItem) => void;
  onDeleteAction: (actionId: string) => void;
  onPostAction: (action: ActionItem) => void;
}

const TYPE_LABELS: Record<ActionItemType, string> = {
  'create-issue': '課題作成',
  'backlog-comment': 'コメント投稿',
  'create-document': 'ドキュメント作成',
  todo: 'TODO',
};

const TYPE_ICONS: Record<ActionItemType, string> = {
  'create-issue': '📋',
  'backlog-comment': '💬',
  'create-document': '📄',
  todo: '☑',
};

export const ActionItems: React.FC<ActionItemsProps> = ({
  actions,
  onUpdateAction,
  onDeleteAction,
  onPostAction,
}) => {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="content-section">
      <h3>アクションアイテム</h3>
      <div className="action-items-list">
        {actions.map((action) => {
          const isExpanded = expandedIds.has(action.id);
          const isPosted = action.status === 'posted' || action.status === 'done';

          return (
            <div key={action.id} className={`action-item ${isPosted ? 'posted' : ''}`}>
              <div className="action-item-header" onClick={() => toggleExpand(action.id)}>
                <span className="action-item-toggle">{isExpanded ? '▼' : '▶'}</span>
                <span className="action-item-icon">{TYPE_ICONS[action.type]}</span>
                <span className="action-item-type-badge">{TYPE_LABELS[action.type]}</span>
                <span className="action-item-title">{action.title}</span>
                {action.issueKey && (
                  <span className="key-badge">{action.issueKey}</span>
                )}
                {isPosted && <span className="status-badge done">完了</span>}
              </div>

              {isExpanded && (
                <div className="action-item-body">
                  <div className="action-item-fields">
                    <label>タイトル</label>
                    <input
                      type="text"
                      value={action.title}
                      readOnly={isPosted}
                      onChange={(e) =>
                        onUpdateAction({ ...action, title: e.target.value })
                      }
                    />
                  </div>

                  {action.type === 'backlog-comment' && (
                    <div className="action-item-fields">
                      <label>課題キー</label>
                      <input
                        type="text"
                        value={action.issueKey || ''}
                        readOnly={isPosted}
                        placeholder="BNN-123"
                        onChange={(e) =>
                          onUpdateAction({ ...action, issueKey: e.target.value })
                        }
                      />
                    </div>
                  )}

                  {action.type === 'create-document' && (
                    <div className="action-item-fields">
                      <label>ドキュメント名</label>
                      <input
                        type="text"
                        value={action.documentName || ''}
                        readOnly={isPosted}
                        onChange={(e) =>
                          onUpdateAction({ ...action, documentName: e.target.value })
                        }
                      />
                    </div>
                  )}

                  <div className="action-item-fields">
                    <label>内容</label>
                    <textarea
                      className="action-item-content"
                      value={action.content}
                      readOnly={isPosted}
                      onChange={(e) =>
                        onUpdateAction({ ...action, content: e.target.value })
                      }
                    />
                  </div>

                  {!isPosted && (
                    <div className="action-item-actions">
                      {action.type !== 'todo' && (
                        <button
                          className="action-btn post-btn"
                          onClick={() => onPostAction(action)}
                        >
                          {TYPE_LABELS[action.type]}
                        </button>
                      )}
                      {action.type === 'todo' && (
                        <button
                          className="action-btn post-btn"
                          onClick={() =>
                            onUpdateAction({ ...action, status: 'done' })
                          }
                        >
                          完了にする
                        </button>
                      )}
                      <button
                        className="action-btn danger-btn small"
                        onClick={() => onDeleteAction(action.id)}
                      >
                        削除
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
