import * as vscode from 'vscode';
import { WorkspaceTodoItem, TodoStatus, SlackMessage } from '../types/workspace';
import { WebviewHelper } from './common';

export interface DraftInfo {
  content: string;
  action: string;
  status: string;
}

export class TodoWebview {
  static getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    todo: WorkspaceTodoItem,
    baseUrl?: string,
    slackContextBefore: SlackMessage[] = [],
    slackContextAfter: SlackMessage[] = [],
    draft?: DraftInfo | null
  ): string {
    const nonce = WebviewHelper.getNonce();
    const head = WebviewHelper.getHtmlHead(
      webview,
      extensionUri,
      todo.text,
      additionalStyles,
      nonce
    );

    const ctx = todo.context;
    const statusLabel = STATUS_LABELS[todo.status] || todo.status;

    // Header badges
    const statusBadge = `<span class="status-badge ${todo.status}">${esc(statusLabel)}</span>`;
    const sourceBadge = ctx
      ? `<span class="meta-item">${esc(SOURCE_LABELS[ctx.source] || ctx.source)}</span>`
      : '';
    const repliedBadge = todo.replied ? `<span class="meta-item replied-badge">返信済</span>` : '';

    // Source link (Backlog issue or Slack thread)
    let sourceLink = '';
    if (ctx?.source === 'backlog-notification' && ctx.issueKey && baseUrl) {
      const issueUrl = `${baseUrl}/view/${ctx.issueKey}`;
      sourceLink = `<a href="#" class="external-link" data-url="${esc(
        issueUrl
      )}">Open in Backlog</a>`;
    } else if (
      (ctx?.source === 'slack-mention' || ctx?.source === 'slack-search') &&
      ctx?.slackChannel
    ) {
      sourceLink = `<a href="#" class="external-link" data-action="openSlackThread">Open in Slack</a>`;
    }

    // Context details section
    let contextHtml = '';
    if (ctx?.source === 'backlog-notification') {
      const fields: string[] = [];
      if (ctx.issueKey) {
        fields.push(
          `<div class="details-field"><label>Issue:</label><span class="key-badge">${esc(
            ctx.issueKey
          )}</span> ${esc(ctx.issueSummary || '')}</span></div>`
        );
      }
      if (ctx.sender) {
        fields.push(
          `<div class="details-field"><label>From:</label><span>${esc(ctx.sender)}</span></div>`
        );
      }
      if (ctx.reason) {
        fields.push(
          `<div class="details-field"><label>Reason:</label><span>${esc(ctx.reason)}</span></div>`
        );
      }
      if (ctx.comment) {
        fields.push(
          `<div class="details-field"><label>Comment:</label></div><div class="context-comment">${esc(
            ctx.comment
          )}</div>`
        );
      }
      if (fields.length > 0) {
        contextHtml = `
          <div class="content-section">
            <h3>Backlog 通知</h3>
            <div class="details-section">${fields.join('')}</div>
          </div>`;
      }
    } else if (ctx?.source === 'slack-mention' || ctx?.source === 'slack-search') {
      const fields: string[] = [];
      if (ctx.slackUserName) {
        fields.push(
          `<div class="details-field"><label>From:</label><span>${esc(
            ctx.slackUserName
          )}</span></div>`
        );
      }

      // Surrounding messages (before)
      const beforeHtml = slackContextBefore
        .map((msg) => buildSlackContextMessageHtml(msg))
        .join('');
      const separatorBefore =
        slackContextBefore.length > 0
          ? '<div class="thread-separator"><span>▼ このメッセージ</span></div>'
          : '';

      // The main message
      const mainMsgHtml = ctx.slackText
        ? `<div class="context-comment slack-main-message">${esc(ctx.slackText)}</div>`
        : '';

      // Surrounding messages (after)
      const separatorAfter =
        slackContextAfter.length > 0
          ? '<div class="thread-separator"><span>▼ 続き</span></div>'
          : '';
      const afterHtml = slackContextAfter.map((msg) => buildSlackContextMessageHtml(msg)).join('');

      const hasContext = slackContextBefore.length > 0 || slackContextAfter.length > 0;

      if (fields.length > 0 || hasContext) {
        contextHtml = `
          <div class="content-section">
            <h3>Slack メッセージ</h3>
            <div class="details-section">
              ${fields.join('')}
              ${beforeHtml}
              ${separatorBefore}
              ${mainMsgHtml}
              ${separatorAfter}
              ${afterHtml}
            </div>
          </div>`;
      }
    }

    // Draft section
    let draftHtml = '';
    if (draft) {
      const postLabel = draft.action === 'slack-reply' ? 'Slack に返信' : 'Backlog にコメント投稿';
      const isPosted = draft.status === 'posted';
      const draftContent = draft.content.trim()
        ? esc(draft.content)
        : '<span class="draft-placeholder">Claude Code がドラフトを書き込み中...</span>';
      const postedBadge = isPosted ? '<span class="status-badge done">投稿済</span>' : '';

      draftHtml = `
        <div class="content-section draft-section">
          <div class="draft-header">
            <h3>返信ドラフト</h3>
            ${postedBadge}
            ${
              !isPosted
                ? '<button class="action-btn secondary small" data-action="refreshDraft">↻ 更新</button>'
                : ''
            }
          </div>
          <div class="draft-content" id="draftContent">${draftContent}</div>
          ${
            !isPosted
              ? `<div class="draft-actions">
                  <button class="action-btn post-btn" data-action="postDraft">${esc(
                    postLabel
                  )}</button>
                  <button class="action-btn danger-btn small" data-action="discardDraft">破棄</button>
                </div>`
              : ''
          }
        </div>`;
    }

    // Notes section
    const notesHtml = `
      <div class="content-section">
        <h3>Notes</h3>
        <textarea id="notesArea" placeholder="メモを追加...">${esc(todo.notes || '')}</textarea>
        <button id="saveNotesBtn" class="action-btn secondary">保存</button>
      </div>`;

    // Timestamps
    const createdAt = new Date(todo.createdAt).toLocaleString();
    const completedAt = todo.completedAt ? new Date(todo.completedAt).toLocaleString() : '';
    const repliedAt = todo.repliedAt ? new Date(todo.repliedAt).toLocaleString() : '';

    let timestampsHtml = `<div class="timestamps"><span>作成: ${createdAt}</span>`;
    if (completedAt) {
      timestampsHtml += `<span>完了: ${completedAt}</span>`;
    }
    if (repliedAt) {
      timestampsHtml += `<span>返信: ${repliedAt}</span>`;
    }
    timestampsHtml += '</div>';

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  ${head}
</head>
<body>
  <div class="webview-header">
    <h1>${esc(todo.text)}</h1>
    <div class="webview-meta">
      ${statusBadge}
      ${sourceBadge}
      ${repliedBadge}
      ${sourceLink}
    </div>
  </div>

  <div class="status-actions">
    <span class="status-actions-label">Status:</span>
    ${buildStatusButtons(todo.status)}
    ${
      ctx &&
      (ctx.source === 'backlog-notification' ||
        ctx.source === 'slack-mention' ||
        ctx.source === 'slack-search') &&
      !draft
        ? '<button class="action-btn claude-btn" data-action="startClaudeSession">✦ Claude で対応</button>'
        : ''
    }
    ${
      !todo.replied &&
      ctx &&
      (ctx.source === 'backlog-notification' || ctx.source === 'slack-mention')
        ? '<button class="action-btn replied-btn" data-action="markReplied">返信済にする</button>'
        : ''
    }
    <button class="action-btn danger-btn" data-action="delete">削除</button>
  </div>

  ${contextHtml}
  ${draftHtml}
  ${notesHtml}
  ${timestampsHtml}

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // Status buttons
    document.querySelectorAll('.status-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        vscode.postMessage({ command: 'setStatus', status: btn.dataset.status });
      });
    });

    // Action buttons
    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (action === 'startClaudeSession') {
          vscode.postMessage({ command: 'startClaudeSession' });
        } else if (action === 'markReplied') {
          vscode.postMessage({ command: 'markReplied' });
        } else if (action === 'delete') {
          vscode.postMessage({ command: 'delete' });
        } else if (action === 'openSlackThread') {
          vscode.postMessage({ command: 'openSlackThread' });
        } else if (action === 'postDraft') {
          vscode.postMessage({ command: 'postDraft' });
        } else if (action === 'discardDraft') {
          vscode.postMessage({ command: 'discardDraft' });
        } else if (action === 'refreshDraft') {
          vscode.postMessage({ command: 'refreshDraft' });
        }
      });
    });

    // Listen for draft updates from the extension
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'updateDraft') {
        const el = document.getElementById('draftContent');
        if (el) {
          if (msg.draft && msg.draft.trim()) {
            el.textContent = msg.draft;
          } else {
            el.innerHTML = '<span class="draft-placeholder">Claude Code がドラフトを書き込み中...</span>';
          }
        }
      }
    });

    // External links
    document.addEventListener('click', (event) => {
      const linkTarget = event.target.closest('a[data-url]');
      if (linkTarget) {
        event.preventDefault();
        event.stopPropagation();
        const url = linkTarget.getAttribute('data-url');
        if (url) {
          vscode.postMessage({ command: 'openExternal', url });
        }
      }
    });

    // Save notes
    document.getElementById('saveNotesBtn').addEventListener('click', () => {
      const notes = document.getElementById('notesArea').value;
      vscode.postMessage({ command: 'saveNotes', notes });
    });

    // Ctrl/Cmd+S to save notes
    document.getElementById('notesArea').addEventListener('keydown', (e) => {
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        document.getElementById('saveNotesBtn').click();
      }
    });
  </script>
</body>
</html>`;
  }
}

// ---- Helpers ----

const STATUS_LABELS: Record<TodoStatus, string> = {
  open: '未着手',
  in_progress: '進行中',
  waiting: '待ち',
  done: '完了',
};

const SOURCE_LABELS: Record<string, string> = {
  'backlog-notification': 'Backlog',
  'slack-mention': 'Slack Mention',
  'slack-search': 'Slack Search',
  manual: 'Manual',
};

function buildStatusButtons(current: TodoStatus): string {
  const statuses: { status: TodoStatus; label: string; icon: string }[] = [
    { status: 'open', label: '未着手', icon: '○' },
    { status: 'in_progress', label: '進行中', icon: '◉' },
    { status: 'waiting', label: '待ち', icon: '◷' },
    { status: 'done', label: '完了', icon: '✓' },
  ];
  return statuses
    .map(
      (s) =>
        `<button class="status-btn ${s.status === current ? 'active' : ''}" data-status="${
          s.status
        }">${s.icon} ${s.label}</button>`
    )
    .join('');
}

function buildSlackContextMessageHtml(msg: SlackMessage): string {
  const time = new Date(parseFloat(msg.ts) * 1000).toLocaleTimeString();
  const sender = msg.userName || msg.user || 'Unknown';
  return `
    <div class="slack-context-msg">
      <span class="slack-context-sender">${esc(sender)}</span>
      <span class="slack-context-time">${time}</span>
      <div class="slack-context-text">${esc(msg.text)}</div>
    </div>`;
}

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const additionalStyles = `
  .status-badge {
    padding: 4px 10px;
    border-radius: 4px;
    font-size: var(--webview-font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
  }
  .status-badge.open { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .status-badge.in_progress { background: #2196F3; color: white; }
  .status-badge.waiting { background: #FF9800; color: white; }
  .status-badge.done { background: #4CAF50; color: white; }

  .replied-badge { background: #26A69A; color: white; }

  .status-actions {
    display: flex;
    align-items: center;
    gap: var(--webview-space-sm);
    flex-wrap: wrap;
    margin: var(--webview-space-lg) 0;
    padding: var(--webview-space-md);
    background: var(--vscode-editor-inactiveSelectionBackground);
    border-radius: var(--webview-radius-md);
  }
  .status-actions-label {
    font-weight: 500;
    font-size: var(--webview-font-size-sm);
    color: var(--vscode-descriptionForeground);
    margin-right: var(--webview-space-xs);
  }
  .status-btn {
    padding: var(--webview-space-xs) var(--webview-space-md);
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--webview-radius-md);
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    cursor: pointer;
    font-size: var(--webview-font-size-sm);
    transition: all 0.15s ease;
  }
  .status-btn:hover {
    background: var(--vscode-button-secondaryHoverBackground);
    transform: translateY(-1px);
  }
  .status-btn.active {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border-color: var(--vscode-button-background);
    font-weight: 600;
  }
  .action-btn {
    padding: var(--webview-space-xs) var(--webview-space-md);
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--webview-radius-md);
    cursor: pointer;
    font-size: var(--webview-font-size-sm);
  }
  .action-btn.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    margin-top: var(--webview-space-sm);
  }
  .action-btn.secondary:hover {
    background: var(--vscode-button-secondaryHoverBackground);
  }
  .action-btn.claude-btn {
    background: #D97706;
    color: white;
    border: none;
    margin-left: auto;
  }
  .action-btn.claude-btn:hover { opacity: 0.9; }
  .action-btn.replied-btn {
    background: #26A69A;
    color: white;
    border: none;
  }
  .action-btn.replied-btn:hover { opacity: 0.9; }
  .action-btn.danger-btn {
    background: transparent;
    color: var(--vscode-errorForeground);
    border-color: var(--vscode-errorForeground);
  }
  .action-btn.danger-btn:hover {
    background: var(--vscode-errorForeground);
    color: white;
  }
  .action-btn.small {
    padding: 2px var(--webview-space-sm);
    font-size: var(--webview-font-size-xs);
  }
  .action-btn.post-btn {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    font-weight: 600;
  }
  .action-btn.post-btn:hover {
    background: var(--vscode-button-hoverBackground);
  }
  .draft-section {
    border: 1px solid var(--vscode-textLink-foreground);
    border-radius: var(--webview-radius-md);
    padding: var(--webview-space-md);
  }
  .draft-header {
    display: flex;
    align-items: center;
    gap: var(--webview-space-sm);
    margin-bottom: var(--webview-space-sm);
  }
  .draft-header h3 { margin: 0; }
  .draft-content {
    white-space: pre-wrap;
    word-break: break-word;
    padding: var(--webview-space-md);
    background: var(--vscode-textCodeBlock-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--webview-radius-sm);
    font-size: var(--webview-font-size-sm);
    line-height: 1.6;
    min-height: 60px;
  }
  .draft-placeholder {
    color: var(--vscode-descriptionForeground);
    font-style: italic;
  }
  .draft-actions {
    display: flex;
    align-items: center;
    gap: var(--webview-space-sm);
    margin-top: var(--webview-space-md);
  }
  .context-comment {
    white-space: pre-wrap;
    word-break: break-word;
    padding: var(--webview-space-md);
    background: var(--vscode-textCodeBlock-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: var(--webview-radius-sm);
    margin-top: var(--webview-space-xs);
    font-size: var(--webview-font-size-sm);
    line-height: 1.6;
  }
  .slack-context-msg {
    padding: var(--webview-space-sm) var(--webview-space-md);
    opacity: 0.55;
    font-size: var(--webview-font-size-sm);
  }
  .slack-context-sender {
    font-weight: 500;
    margin-right: var(--webview-space-sm);
  }
  .slack-context-time {
    color: var(--vscode-descriptionForeground);
    font-size: var(--webview-font-size-xs);
  }
  .slack-context-text {
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.6;
    margin-top: 2px;
  }
  .slack-main-message {
    border-left: 3px solid var(--vscode-textLink-foreground);
  }
  .thread-separator {
    display: flex;
    align-items: center;
    gap: var(--webview-space-sm);
    margin: var(--webview-space-md) 0;
    color: var(--vscode-descriptionForeground);
    font-size: var(--webview-font-size-xs);
  }
  .thread-separator::before,
  .thread-separator::after {
    content: '';
    flex: 1;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  #notesArea {
    width: 100%;
    min-height: 120px;
    padding: var(--webview-space-md);
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: var(--webview-radius-md);
    font-family: var(--webview-font-family);
    font-size: var(--webview-font-size-base);
    resize: vertical;
    box-sizing: border-box;
    line-height: 1.6;
  }
  #notesArea:focus {
    outline: none;
    border-color: var(--vscode-focusBorder);
  }
  .timestamps {
    display: flex;
    gap: var(--webview-space-lg);
    color: var(--vscode-descriptionForeground);
    font-size: var(--webview-font-size-xs);
    margin-top: var(--webview-space-xl);
    padding-top: var(--webview-space-md);
    border-top: 1px solid var(--vscode-panel-border);
  }
`;
