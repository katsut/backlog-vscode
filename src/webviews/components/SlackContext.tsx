import React from 'react';
import { WorkspaceTodoItem, SlackMessage } from '../../types/workspace';

interface SlackContextProps {
  todo: WorkspaceTodoItem;
  slackContextBefore?: SlackMessage[];
  slackContextAfter?: SlackMessage[];
}

const formatSlackMessage = (text: string): string => {
  if (!text) return '';

  // Decode HTML entities that Slack API might send
  let formatted = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');

  // Escape for safe HTML display
  const escapeHtml = (str: string) =>
    str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  formatted = escapeHtml(formatted);

  // Format blockquotes (lines starting with >)
  formatted = formatted.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');
  formatted = formatted.replace(/(<\/blockquote>\n<blockquote>)/g, '\n');

  // Format Slack links with label: <URL|label>
  formatted = formatted.replace(/&lt;(https?:\/\/[^|&gt;]+)\|([^&gt;]+)&gt;/g, '<a href="$1">$2</a>');
  // Format Slack links without label: <URL>
  formatted = formatted.replace(/&lt;(https?:\/\/[^&gt;]+)&gt;/g, '<a href="$1">$1</a>');

  // Format mentions with display name: <@USER_ID|Display Name>
  formatted = formatted.replace(
    /&lt;@[A-Z0-9]+\|([^&gt;]+)&gt;/g,
    '<span class="slack-mention">@$1</span>'
  );
  // Format mentions without display name: <@USER_ID>
  formatted = formatted.replace(/&lt;@([A-Z0-9]+)&gt;/g, '<span class="slack-mention">@$1</span>');
  // Format channel mentions: <#CHANNEL_ID|channel-name>
  formatted = formatted.replace(
    /&lt;#[A-Z0-9]+\|([^&gt;]+)&gt;/g,
    '<span class="slack-mention">#$1</span>'
  );

  // Format plain text URLs (not already wrapped in Slack format)
  // Match http:// or https:// URLs that are not already inside <a> tags
  formatted = formatted.replace(
    /(?<!href=&quot;)(https?:\/\/[^\s&lt;&gt;]+)/g,
    '<a href="$1">$1</a>'
  );

  // Format Slack markdown
  // Code blocks first (before inline code): ```text```
  formatted = formatted.replace(/```([^`]+)```/g, '<pre><code>$1</code></pre>');
  // Inline code: `text`
  formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold: *text*
  formatted = formatted.replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>');
  // Italic: _text_
  formatted = formatted.replace(/_([^_\n]+)_/g, '<em>$1</em>');
  // Strikethrough: ~text~
  formatted = formatted.replace(/~([^~\n]+)~/g, '<s>$1</s>');

  // Convert line breaks to <br>
  formatted = formatted.replace(/\n/g, '<br>');

  return formatted;
};

const SlackMessageItem: React.FC<{ message: SlackMessage }> = ({ message }) => {
  const formatTimestamp = (ts: string) => {
    const date = new Date(parseFloat(ts) * 1000);
    return date.toLocaleTimeString('ja-JP', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  };

  return (
    <div className="slack-context-message">
      <div className="slack-message-meta">
        <span className="slack-user">{message.userName || 'Unknown'}</span>
        <span className="slack-timestamp">{formatTimestamp(message.ts)}</span>
      </div>
      <div
        className="slack-message-text"
        dangerouslySetInnerHTML={{ __html: formatSlackMessage(message.text || '') }}
      />
    </div>
  );
};

export const SlackContext: React.FC<SlackContextProps> = ({
  todo,
  slackContextBefore = [],
  slackContextAfter = [],
}) => {
  const ctx = todo.context;

  if (ctx?.source !== 'slack-mention' && ctx?.source !== 'slack-search') {
    return null;
  }

  const hasContext = slackContextBefore.length > 0 || slackContextAfter.length > 0;

  return (
    <>
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
              <div
                className="context-comment slack-main-message"
                dangerouslySetInnerHTML={{ __html: formatSlackMessage(ctx.slackText) }}
              />
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
