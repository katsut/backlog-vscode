import React from 'react';
import { WorkspaceTodoItem } from '../../types/workspace';

interface BacklogContextProps {
  todo: WorkspaceTodoItem;
  baseUrl?: string;
  fullContext?: string;
  onOpenExternal: (url: string) => void;
}

interface IssueMetadata {
  issueType?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  dueDate?: string;
  milestone?: string;
  category?: string;
}

const parseIssueMetadata = (html: string): IssueMetadata => {
  const metadata: IssueMetadata = {};

  // Extract from pattern like: <strong>種別:</strong> 規程・労使協定 | <strong>ステータス:</strong> In Progress
  const metaLineMatch = html.match(/<strong>種別:<\/strong>\s*([^|<]+)\s*\|\s*<strong>ステータス:<\/strong>\s*([^|<]+)\s*\|\s*<strong>優先度:<\/strong>\s*([^<]+)/);
  if (metaLineMatch) {
    metadata.issueType = metaLineMatch[1].trim();
    metadata.status = metaLineMatch[2].trim();
    metadata.priority = metaLineMatch[3].trim();
  }

  const assignLineMatch = html.match(/<strong>担当:<\/strong>\s*([^|<]+)\s*\|\s*<strong>期日:<\/strong>\s*([^<]+)/);
  if (assignLineMatch) {
    metadata.assignee = assignLineMatch[1].trim();
    metadata.dueDate = assignLineMatch[2].trim();
  }

  const milestoneMatch = html.match(/<strong>マイルストーン:<\/strong>\s*([^<]+)/);
  if (milestoneMatch) {
    metadata.milestone = milestoneMatch[1].trim();
  }

  const categoryMatch = html.match(/<strong>カテゴリ:<\/strong>\s*([^<]+)/);
  if (categoryMatch) {
    metadata.category = categoryMatch[1].trim();
  }

  return metadata;
};

const extractDescription = (html: string): string | null => {
  const descMatch = html.match(/<h3>説明<\/h3>\s*<blockquote>([\s\S]*?)<\/blockquote>/);
  return descMatch ? descMatch[1].trim() : null;
};

export const BacklogContext: React.FC<BacklogContextProps> = ({
  todo,
  baseUrl,
  fullContext,
  onOpenExternal,
}) => {
  const ctx = todo.context;

  if (ctx?.source !== 'backlog-notification') {
    return null;
  }

  // Parse issue details from fullContext
  let metadata: IssueMetadata = {};
  let description: string | null = null;
  let triggerNotification: React.ReactNode = null;

  if (fullContext) {
    const sections = fullContext.split('## コメント');
    const issueDetails = sections[0] || '';

    metadata = parseIssueMetadata(issueDetails);
    description = extractDescription(issueDetails);

    // Build trigger notification section
    if (ctx.sender || ctx.comment) {
      triggerNotification = (
        <div className="content-section notif-trigger-section">
          <h3>対象の通知</h3>
          <div className="notif-trigger">
            <div className="notif-meta">
              {ctx.sender && <span className="notif-sender">{ctx.sender}</span>}
              {ctx.reason && <span className="notif-reason">{ctx.reason}</span>}
            </div>
            {ctx.comment && (
              <div className="notif-comment">{ctx.comment}</div>
            )}
          </div>
        </div>
      );
    }
  }

  return (
    <>
      {Object.keys(metadata).some((key) => metadata[key as keyof IssueMetadata]) && (
        <div className="content-section">
          <div className="issue-metadata">
            {metadata.issueType && (
              <div className="metadata-item">
                <label>種別</label>
                <span>{metadata.issueType}</span>
              </div>
            )}
            {metadata.status && (
              <div className="metadata-item">
                <label>ステータス</label>
                <span className="status-badge">{metadata.status}</span>
              </div>
            )}
            {metadata.priority && (
              <div className="metadata-item">
                <label>優先度</label>
                <span>{metadata.priority}</span>
              </div>
            )}
            {metadata.assignee && (
              <div className="metadata-item">
                <label>担当</label>
                <span>{metadata.assignee}</span>
              </div>
            )}
            {metadata.dueDate && (
              <div className="metadata-item">
                <label>期日</label>
                <span>{metadata.dueDate}</span>
              </div>
            )}
            {metadata.milestone && (
              <div className="metadata-item full-width">
                <label>マイルストーン</label>
                <span>{metadata.milestone}</span>
              </div>
            )}
            {metadata.category && (
              <div className="metadata-item full-width">
                <label>カテゴリ</label>
                <span>{metadata.category}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {description && (
        <div className="content-section">
          <h3>説明</h3>
          <div className="issue-description" dangerouslySetInnerHTML={{ __html: description }} />
        </div>
      )}

      {triggerNotification}

      {/* Comment history will be rendered after draft section */}
    </>
  );
};

interface BacklogCommentHistoryProps {
  fullContext?: string;
}

export const BacklogCommentHistory: React.FC<BacklogCommentHistoryProps> = ({ fullContext }) => {
  if (!fullContext) {
    return null;
  }

  const sections = fullContext.split('## コメント履歴');
  const commentHistory = sections[1] || '';

  if (!commentHistory.trim()) {
    return null;
  }

  return (
    <div className="content-section">
      <div className="full-context" dangerouslySetInnerHTML={{ __html: commentHistory }} />
    </div>
  );
};
