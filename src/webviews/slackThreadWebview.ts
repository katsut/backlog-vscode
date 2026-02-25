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
    const head = WebviewHelper.getHtmlHead(webview, extensionUri, title);

    const parentMessage = messages[0];
    const replies = messages.slice(1);

    const beforeHtml =
      contextBefore.length > 0
        ? contextBefore.map((msg) => buildMessageHtml(msg, 'context-message')).join('')
        : '';

    const threadSeparatorBefore =
      contextBefore.length > 0 ? '<div class="thread-separator"><span>Thread</span></div>' : '';

    const parentHtml = parentMessage ? buildMessageHtml(parentMessage, 'thread-parent') : '';

    const repliesHtml = replies.map((msg) => buildMessageHtml(msg, 'thread-reply')).join('');

    const repliesLabel =
      replies.length > 0
        ? `<div class="thread-replies-label">${replies.length} ${
            replies.length === 1 ? 'reply' : 'replies'
          }</div>`
        : '';

    const threadSeparatorAfter =
      contextAfter.length > 0 ? '<div class="thread-separator"><span>Channel</span></div>' : '';

    const afterHtml =
      contextAfter.length > 0
        ? contextAfter.map((msg) => buildMessageHtml(msg, 'context-message')).join('')
        : '';

    const openInSlackBtn = slackUrl
      ? `<a href="#" class="external-link" data-url="${escapeHtml(slackUrl)}">Open in Slack</a>`
      : '';

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  ${head}
  <style>
    .thread-parent {
      border-left: 4px solid var(--vscode-textLink-foreground);
    }
    .thread-reply {
      margin-left: var(--webview-space-xl);
    }
    .thread-replies-label {
      padding: var(--webview-space-sm) 0;
      color: var(--vscode-descriptionForeground);
      font-size: var(--webview-font-size-sm);
      font-weight: 500;
      border-bottom: 1px solid var(--vscode-panel-border);
      margin: var(--webview-space-md) 0;
    }
    .message-text {
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.6;
    }
    .context-message {
      opacity: 0.55;
    }
    .thread-separator {
      display: flex;
      align-items: center;
      gap: var(--webview-space-sm);
      margin: var(--webview-space-md) 0;
      color: var(--vscode-descriptionForeground);
      font-size: var(--webview-font-size-sm);
      font-weight: 500;
    }
    .thread-separator::before,
    .thread-separator::after {
      content: '';
      flex: 1;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
  </style>
</head>
<body>
  <div class="webview-header">
    <h1>${escapeHtml(title)}</h1>
    <div class="webview-meta">
      <span class="meta-item">${messages.length} messages</span>
      ${openInSlackBtn}
      <a href="#" class="external-link" id="addToTodoBtn">+ Add to TODO</a>
    </div>
  </div>

  ${beforeHtml}
  ${threadSeparatorBefore}
  ${parentHtml}
  ${repliesLabel}
  <div class="thread-messages">${repliesHtml}</div>
  ${threadSeparatorAfter}
  ${afterHtml}

  <script>
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
  const time = new Date(parseFloat(msg.ts) * 1000).toLocaleTimeString();
  const sender = msg.userName || msg.user || 'Unknown';
  const text = escapeHtml(msg.text);

  return `
    <div class="comment ${className}">
      <div class="comment-header">
        <span class="comment-author">${escapeHtml(sender)}</span>
        <span class="comment-date">${time}</span>
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
