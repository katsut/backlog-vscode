import React from 'react';
import { WorkspaceTodoItem, SlackMessage } from '../../types/workspace';

interface SlackContextProps {
  todo: WorkspaceTodoItem;
  slackContextBefore?: SlackMessage[];
  slackContextAfter?: SlackMessage[];
  onOpenSlackThread: () => void;
}

const SlackMessageItem: React.FC<{ message: SlackMessage }> = ({ message }) => {
  return (
    <div className="slack-context-message">
      <div className="slack-message-meta">
        <span className="slack-user">{message.userName || 'Unknown'}</span>
        <span className="slack-timestamp">{message.timestamp || ''}</span>
      </div>
      <div className="slack-message-text">{message.text || ''}</div>
    </div>
  );
};

export const SlackContext: React.FC<SlackContextProps> = ({
  todo,
  slackContextBefore = [],
  slackContextAfter = [],
  onOpenSlackThread,
}) => {
  const ctx = todo.context;

  if (ctx?.source !== 'slack-mention' && ctx?.source !== 'slack-search') {
    return null;
  }

  const hasContext = slackContextBefore.length > 0 || slackContextAfter.length > 0;

  return (
    <>
      <div className="content-section">
        <div className="source-link-section">
          <a
            href="#"
            className="external-link link-slack"
            onClick={(e) => {
              e.preventDefault();
              onOpenSlackThread();
            }}
          >
            Open in Slack
          </a>
        </div>
      </div>

      {(hasContext || ctx.slackText) && (
        <div className="content-section">
          <h3>Slack メッセージ</h3>
          <div className="details-section">
            {ctx.slackUserName && (
              <div className="details-field">
                <label>From:</label>
                <span>{ctx.slackUserName}</span>
              </div>
            )}

            {slackContextBefore.map((msg, i) => (
              <SlackMessageItem key={`before-${i}`} message={msg} />
            ))}

            {slackContextBefore.length > 0 && (
              <div className="thread-separator">
                <span>▼ このメッセージ</span>
              </div>
            )}

            {ctx.slackText && (
              <div className="context-comment slack-main-message">{ctx.slackText}</div>
            )}

            {slackContextAfter.length > 0 && (
              <div className="thread-separator">
                <span>▼ 続き</span>
              </div>
            )}

            {slackContextAfter.map((msg, i) => (
              <SlackMessageItem key={`after-${i}`} message={msg} />
            ))}
          </div>
        </div>
      )}
    </>
  );
};
