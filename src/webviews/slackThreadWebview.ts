import * as vscode from 'vscode';
import { SlackMessage } from '../types/workspace';
import { WebviewHelper } from './common';

export class SlackThreadWebview {
  static getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    messages: SlackMessage[],
    title: string,
    slackUrl?: string | null,
    contextBefore: SlackMessage[] = [],
    contextAfter: SlackMessage[] = []
  ): string {
    const nonce = WebviewHelper.getNonce();

    const parentMessage = messages[0];
    const replies = messages.slice(1);

    const beforeHtml =
      contextBefore.length > 0
        ? contextBefore.map((msg) => buildMessageHtml(msg, 'context-message')).join('')
        : '';

    const threadSeparatorBefore =
      contextBefore.length > 0
        ? '<div class="thread-separator"><span>📍 スレッド開始</span></div>'
        : '';

    const parentHtml = parentMessage ? buildMessageHtml(parentMessage, 'thread-parent') : '';

    const repliesHtml = replies.map((msg) => buildMessageHtml(msg, 'thread-reply')).join('');

    const repliesLabel =
      replies.length > 0
        ? `<div class="thread-replies-header">
            <div class="thread-replies-label">💬 ${replies.length}件の返信</div>
          </div>`
        : '';

    const threadSeparatorAfter =
      contextAfter.length > 0
        ? '<div class="thread-separator"><span>📢 チャンネルの他のメッセージ</span></div>'
        : '';

    const afterHtml =
      contextAfter.length > 0
        ? contextAfter.map((msg) => buildMessageHtml(msg, 'context-message')).join('')
        : '';

    const openInSlackBtn = slackUrl
      ? `<a href="#" class="external-link link-slack" data-url="${escapeHtml(
          slackUrl
        )}">Slack で開く</a>`
      : '';

    const additionalStyles = `
      /* Thread parent message - featured card */
      .thread-parent {
        background: var(--vscode-editor-inactiveSelectionBackground);
        border-left: 4px solid var(--slack-color);
        border-radius: 0 var(--webview-radius-lg) var(--webview-radius-lg) 0;
        padding: var(--webview-space-lg);
        margin: var(--webview-space-md) 0 var(--webview-space-xl) 0;
        box-shadow: var(--webview-shadow-md);
      }

      .thread-parent .comment-header {
        margin-bottom: var(--webview-space-md);
        padding-bottom: var(--webview-space-sm);
        border-bottom: 1px solid var(--vscode-panel-border);
      }

      .thread-parent .comment-author {
        font-size: var(--webview-font-size-base);
        font-weight: 600;
      }

      .thread-parent .message-text {
        font-size: var(--webview-font-size-base);
        line-height: 1.7;
        color: var(--vscode-foreground);
      }

      /* Thread replies - indented conversation */
      .thread-replies-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin: var(--webview-space-xl) 0 var(--webview-space-md) 0;
      }

      .thread-replies-label {
        display: inline-flex;
        align-items: center;
        gap: var(--webview-space-xs);
        padding: var(--webview-space-xs) var(--webview-space-md);
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        border-radius: var(--webview-radius-xl);
        font-size: var(--webview-font-size-sm);
        font-weight: 600;
      }

      .thread-reply {
        margin-left: var(--webview-space-2xl);
        padding-left: var(--webview-space-md);
        border-left: 2px solid var(--vscode-panel-border);
      }

      .thread-reply .comment {
        padding: var(--webview-space-md) 0;
      }

      /* Message text styling */
      .message-text {
        word-break: break-word;
        line-height: 1.6;
        color: var(--vscode-foreground);
      }

      .message-text blockquote {
        border-left: 3px solid var(--vscode-textBlockQuote-border);
        background: var(--vscode-textBlockQuote-background);
        margin: var(--webview-space-xs) 0;
        padding: var(--webview-space-xs) var(--webview-space-md);
        font-style: italic;
      }

      .message-text a {
        color: var(--vscode-textLink-foreground);
        text-decoration: none;
      }

      .message-text a:hover {
        color: var(--vscode-textLink-activeForeground);
        text-decoration: underline;
      }

      .message-text .slack-mention {
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        padding: 1px 4px;
        border-radius: 3px;
        font-weight: 600;
      }

      .message-text code {
        background: var(--vscode-textCodeBlock-background);
        color: var(--vscode-textPreformat-foreground);
        padding: 2px 4px;
        border-radius: 3px;
        font-family: var(--webview-mono-font-family);
        font-size: 0.9em;
      }

      .message-text pre {
        background: var(--vscode-textCodeBlock-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: var(--webview-radius-md);
        padding: var(--webview-space-sm);
        margin: var(--webview-space-xs) 0;
        overflow-x: auto;
      }

      .message-text pre code {
        background: transparent;
        padding: 0;
        font-size: var(--webview-font-size-sm);
      }

      .message-text strong {
        font-weight: 600;
      }

      .message-text em {
        font-style: italic;
      }

      .message-text s {
        text-decoration: line-through;
        opacity: 0.7;
      }

      /* Context messages - muted appearance */
      .context-message {
        opacity: 0.6;
        transition: opacity 0.2s ease;
      }

      .context-message:hover {
        opacity: 0.85;
      }

      .context-message .comment-author {
        font-size: var(--webview-font-size-xs);
      }

      .context-message .message-text {
        font-size: var(--webview-font-size-sm);
      }

      /* Thread separators */
      .thread-separator {
        display: flex;
        align-items: center;
        gap: var(--webview-space-sm);
        margin: var(--webview-space-2xl) 0 var(--webview-space-lg) 0;
        color: var(--vscode-descriptionForeground);
        font-size: var(--webview-font-size-sm);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .thread-separator::before,
      .thread-separator::after {
        content: '';
        flex: 1;
        height: 2px;
        background: linear-gradient(
          to right,
          transparent,
          var(--vscode-panel-border) 50%,
          transparent
        );
      }

      .thread-separator span {
        padding: 0 var(--webview-space-sm);
        background: var(--vscode-editor-background);
      }

      /* Main content area with padding */
      .thread-content {
        padding: 0 var(--webview-space-xl) var(--webview-space-2xl);
      }

      /* Comment enhancements */
      .comment {
        padding: var(--webview-space-md) 0;
      }

      .comment-header {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        margin-bottom: var(--webview-space-sm);
      }

      .comment-author {
        font-weight: 600;
        font-size: var(--webview-font-size-sm);
        color: var(--vscode-textLink-foreground);
      }

      .comment-date {
        font-size: var(--webview-font-size-xs);
        color: var(--vscode-descriptionForeground);
      }
    `;

    const head = WebviewHelper.getHtmlHead(webview, extensionUri, title, additionalStyles, nonce);

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  ${head}
</head>
<body>
  <div class="webview-header">
    <h1>${escapeHtml(title)}</h1>
    <div class="webview-meta">
      <span class="meta-item source-slack">💬 Slack</span>
      <span class="meta-item">${messages.length} メッセージ</span>
      ${openInSlackBtn}
      <a href="#" class="external-link" id="addToTodoBtn">+ TODO に追加</a>
    </div>
  </div>

  <div class="thread-content">
    ${beforeHtml}
    ${threadSeparatorBefore}
    ${parentHtml}
    ${repliesLabel}
    <div class="thread-messages">${repliesHtml}</div>
    ${threadSeparatorAfter}
    ${afterHtml}
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.addEventListener('click', (event) => {
      const target = event.target;

      if (target.closest('#addToTodoBtn')) {
        event.preventDefault();
        event.stopPropagation();
        vscode.postMessage({ command: 'addToTodo' });
        return;
      }

      const linkTarget = target.closest('a[data-url]');
      if (linkTarget) {
        event.preventDefault();
        event.stopPropagation();
        const url = linkTarget.getAttribute('data-url');
        if (url) {
          vscode.postMessage({ command: 'openExternal', url });
        }
      }
    });
  </script>
</body>
</html>`;
  }
}

function buildMessageHtml(msg: SlackMessage, className: string): string {
  const date = new Date(parseFloat(msg.ts) * 1000);
  const time = date.toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const fullDate = date.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const sender = msg.userName || msg.user || 'Unknown';
  const text = formatSlackMessage(msg.text);

  return `
    <div class="comment ${className}">
      <div class="comment-header">
        <span class="comment-author">${escapeHtml(sender)}</span>
        <span class="comment-date" title="${fullDate}">${time}</span>
      </div>
      <div class="comment-content">
        <div class="message-text">${text}</div>
      </div>
    </div>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatSlackMessage(text: string): string {
  if (!text) return '';

  // First decode HTML entities that Slack API might send
  let formatted = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');

  // Now escape HTML for safe display
  formatted = escapeHtml(formatted);

  // Format blockquotes (lines starting with >)
  formatted = formatted.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');

  // Merge consecutive blockquotes
  formatted = formatted.replace(/(<\/blockquote>\n<blockquote>)/g, '\n');

  // Format Slack links with label: <URL|label>
  formatted = formatted.replace(
    /&lt;(https?:\/\/[^|&gt;]+)\|([^&gt;]+)&gt;/g,
    '<a href="$1">$2</a>'
  );
  // Format Slack links without label: <URL>
  formatted = formatted.replace(/&lt;(https?:\/\/[^&gt;]+)&gt;/g, '<a href="$1">$1</a>');

  // Format mentions with display name: <@USER_ID|Display Name>
  formatted = formatted.replace(
    /&lt;@[A-Z0-9]+\|([^&gt;]+)&gt;/g,
    '<span class="slack-mention">@$1</span>'
  );
  // Format mentions without display name: <@USER_ID>
  formatted = formatted.replace(/&lt;@([A-Z0-9]+)&gt;/g, '<span class="slack-mention">@$1</span>');

  // Format Slack channel mentions: <#CHANNEL_ID|channel-name>
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
}
