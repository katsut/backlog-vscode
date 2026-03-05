import React from 'react';
import { WorkspaceTodoItem } from '../../types/workspace';

interface BacklogContextProps {
  todo: WorkspaceTodoItem;
  baseUrl?: string;
  fullContext?: string;
  onOpenExternal: (url: string) => void;
}

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

  const fullBaseUrl = baseUrl
    ? baseUrl.startsWith('http')
      ? baseUrl
      : `https://${baseUrl}`
    : '';

  const issueUrl =
    ctx.issueKey && fullBaseUrl ? `${fullBaseUrl}/view/${ctx.issueKey}` : null;

  // Split fullContext into issue details and comment history
  let issueDetails = '';
  let commentHistory = '';
  let triggerNotification: React.ReactNode = null;

  if (fullContext) {
    const sections = fullContext.split('## コメント履歴');
    issueDetails = sections[0] || '';
    commentHistory = sections[1] || '';

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
              <div className="notif-comment" dangerouslySetInnerHTML={{ __html: ctx.comment }} />
            )}
          </div>
        </div>
      );
    }
  }

  return (
    <>
      {issueUrl && (
        <div className="content-section">
          <div className="source-link-section">
            <a
              href="#"
              className="external-link"
              onClick={(e) => {
                e.preventDefault();
                onOpenExternal(issueUrl);
              }}
            >
              Open in Backlog
            </a>
          </div>
        </div>
      )}

      {issueDetails && (
        <div className="content-section">
          <div className="full-context" dangerouslySetInnerHTML={{ __html: issueDetails }} />
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
