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

    // Format event time — extract directly from ISO string to avoid UTC conversion
    let timeStr = '';
    if (event.start.dateTime && event.end.dateTime) {
      const datePart = event.start.dateTime.slice(0, 10).replace(/-/g, '/');
      const startTime = event.start.dateTime.slice(11, 16);
      const endTime = event.end.dateTime.slice(11, 16);
      timeStr = `${datePart} ${startTime} - ${endTime}`;
    } else if (event.start.date) {
      timeStr = event.start.date;
    }

    // Attendees list
    const attendees = (event.attendees || [])
      .filter((a) => !a.self)
      .map((a) => WebviewHelper.escapeHtml(a.displayName || a.email));

    const additionalStyles = `
      .meeting-header {
        margin-bottom: var(--webview-space-md, 12px);
        padding-bottom: var(--webview-space-md, 12px);
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
      .actions {
        display: flex;
        align-items: center;
        gap: var(--webview-space-sm, 8px);
        flex-wrap: wrap;
        margin-bottom: var(--webview-space-lg, 16px);
        padding: var(--webview-space-md, 12px);
        background: var(--vscode-editor-inactiveSelectionBackground);
        border-radius: var(--webview-radius-md, 6px);
      }
      .action-btn {
        padding: var(--webview-space-xs, 4px) var(--webview-space-md, 12px);
        border: 1px solid var(--vscode-panel-border);
        border-radius: var(--webview-radius-md, 6px);
        cursor: pointer;
        font-size: var(--webview-font-size-sm, 0.85em);
        font-family: inherit;
      }
      .action-btn.secondary {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
      }
      .action-btn.secondary:hover {
        background: var(--vscode-button-secondaryHoverBackground);
      }
      .doc-content {
        line-height: 1.7;
      }
      .doc-content img {
        max-width: 100%;
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

  <div class="actions">
    <button class="action-btn secondary" onclick="openExternal()">ブラウザで開く</button>
    <button class="action-btn secondary" onclick="copyContent()">Markdown をコピー</button>
  </div>

  <div class="doc-content">
    ${sanitizeGoogleHtml(htmlContent)}
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

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
