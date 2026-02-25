import * as vscode from 'vscode';
import { WebviewHelper } from './common';
import { GoogleCalendarEvent, GoogleDriveFile } from '../types/google';

export class MeetingNotesWebview {
  static getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    event: GoogleCalendarEvent,
    file: GoogleDriveFile,
    htmlContent: string
  ): string {
    const nonce = WebviewHelper.getNonce();

    // Format event time
    let timeStr = '';
    if (event.start.dateTime && event.end.dateTime) {
      const start = new Date(event.start.dateTime);
      const end = new Date(event.end.dateTime);
      const dateFmt = `${start.getFullYear()}/${start.getMonth() + 1}/${start.getDate()}`;
      const timeFmt = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
      timeStr = `${dateFmt} ${timeFmt(start)} - ${timeFmt(end)}`;
    } else if (event.start.date) {
      timeStr = event.start.date;
    }

    // Attendees list
    const attendees = (event.attendees || [])
      .filter((a) => !a.self)
      .map((a) => WebviewHelper.escapeHtml(a.displayName || a.email));

    const additionalStyles = `
      .meeting-header {
        margin-bottom: 20px;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--vscode-panel-border);
      }
      .meeting-title {
        font-size: 1.4em;
        font-weight: 600;
        margin: 0 0 8px 0;
      }
      .meeting-meta {
        color: var(--vscode-descriptionForeground);
        font-size: 0.9em;
        line-height: 1.6;
      }
      .meeting-meta span {
        margin-right: 16px;
      }
      .attendees {
        margin-top: 8px;
      }
      .attendee-chip {
        display: inline-block;
        padding: 2px 8px;
        margin: 2px 4px 2px 0;
        border-radius: 12px;
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        font-size: 0.85em;
      }
      .doc-content {
        margin-top: 16px;
        line-height: 1.7;
      }
      .doc-content img {
        max-width: 100%;
      }
      .actions {
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid var(--vscode-panel-border);
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .action-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 14px;
        border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder, transparent));
        border-radius: 4px;
        cursor: pointer;
        font-size: 0.9em;
        font-family: inherit;
      }
      .action-btn.primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      .action-btn.primary:hover {
        background: var(--vscode-button-hoverBackground);
      }
      .action-btn.secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
      }
      .action-btn.secondary:hover {
        background: var(--vscode-button-secondaryHoverBackground);
      }
    `;

    const head = WebviewHelper.getHtmlHead(
      webview,
      extensionUri,
      `${file.name}`,
      additionalStyles,
      nonce
    );

    return `<!DOCTYPE html>
<html lang="ja">
${head}
<body>
  <div class="meeting-header">
    <h1 class="meeting-title">${WebviewHelper.escapeHtml(event.summary || '(No title)')}</h1>
    <div class="meeting-meta">
      <span>${WebviewHelper.escapeHtml(timeStr)}</span>
    </div>
    ${
      attendees.length > 0
        ? `<div class="attendees">
            ${attendees.map((a) => `<span class="attendee-chip">${a}</span>`).join('')}
          </div>`
        : ''
    }
  </div>

  <div class="doc-content">
    ${sanitizeGoogleHtml(htmlContent)}
  </div>

  <div class="actions">
    <button class="action-btn primary" onclick="createIssue()">Backlog 課題を作成</button>
    <button class="action-btn primary" onclick="sendToClaudeCode()">Claude Code で扱う</button>
    <button class="action-btn secondary" onclick="copyContent()">Markdown をコピー</button>
    <button class="action-btn secondary" onclick="openExternal()">ブラウザで開く</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    function createIssue() {
      const content = document.querySelector('.doc-content')?.innerText || '';
      vscode.postMessage({
        command: 'createBacklogIssue',
        eventSummary: ${JSON.stringify(event.summary || '')},
        content: content
      });
    }

    function copyContent() {
      const content = document.querySelector('.doc-content')?.innerText || '';
      vscode.postMessage({
        command: 'copyToClipboard',
        content: content
      });
    }

    function openExternal() {
      vscode.postMessage({
        command: 'openExternal',
        url: ${JSON.stringify(file.webViewLink || '')}
      });
    }

    function sendToClaudeCode() {
      vscode.postMessage({
        command: 'sendToClaudeCode'
      });
    }
  </script>
</body>
</html>`;
  }
}

/** Strip Google Docs export styling but keep structure */
function sanitizeGoogleHtml(html: string): string {
  // Remove <style> blocks from Google export
  let cleaned = html.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Remove inline styles
  cleaned = cleaned.replace(/\s*style="[^"]*"/gi, '');
  // Remove class attributes
  cleaned = cleaned.replace(/\s*class="[^"]*"/gi, '');
  // Remove <meta> / <link> / <title> tags
  cleaned = cleaned.replace(/<(meta|link|title)[^>]*\/?>/gi, '');
  // Remove <html>, <head>, <body> wrappers
  cleaned = cleaned.replace(/<\/?(html|head|body)[^>]*>/gi, '');
  return cleaned.trim();
}
