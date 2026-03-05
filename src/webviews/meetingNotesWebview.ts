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

    // Detect document type from file name
    const docType = this.detectDocumentType(file.name, event.summary || '');

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
      /* Meeting-specific styles */
      .meeting-time-badge {
        display: inline-flex;
        align-items: center;
        gap: var(--webview-space-xs);
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        padding: var(--webview-space-xs) var(--webview-space-md);
        border-radius: var(--webview-radius-md);
        font-size: var(--webview-font-size-sm);
        font-weight: 500;
      }

      .meeting-info-section {
        background: var(--vscode-editor-inactiveSelectionBackground);
        border-left: 4px solid var(--calendar-color);
        border-radius: 0 var(--webview-radius-lg) var(--webview-radius-lg) 0;
        padding: var(--webview-space-lg);
        margin: var(--webview-space-xl) 0;
        box-shadow: var(--webview-shadow-sm);
      }

      .meeting-info-row {
        display: flex;
        align-items: center;
        gap: var(--webview-space-md);
        margin-bottom: var(--webview-space-sm);
      }

      .meeting-info-label {
        font-weight: 600;
        font-size: var(--webview-font-size-sm);
        color: var(--vscode-descriptionForeground);
        min-width: 80px;
      }

      .doc-content {
        padding: var(--webview-space-xl);
        line-height: 1.7;
        font-family: var(--webview-font-family);
        color: var(--vscode-foreground);
      }

      .doc-content img {
        max-width: 100%;
        border-radius: var(--webview-radius-md);
        box-shadow: var(--webview-shadow-md);
        margin: var(--webview-space-md) 0;
      }

      .doc-content h1, .doc-content h2, .doc-content h3 {
        color: var(--vscode-foreground);
        margin-top: var(--webview-space-xl);
        margin-bottom: var(--webview-space-md);
        font-weight: 600;
      }

      .doc-content h1 {
        font-size: var(--webview-font-size-2xl);
        border-bottom: 2px solid var(--vscode-panel-border);
        padding-bottom: var(--webview-space-sm);
      }

      .doc-content h2 {
        font-size: var(--webview-font-size-xl);
      }

      .doc-content h3 {
        font-size: var(--webview-font-size-lg);
      }

      .doc-content p {
        margin: var(--webview-space-md) 0;
        line-height: 1.7;
      }

      .doc-content ul, .doc-content ol {
        margin: var(--webview-space-md) 0;
        padding-left: var(--webview-space-2xl);
      }

      .doc-content li {
        margin: var(--webview-space-xs) 0;
        line-height: 1.6;
      }

      .doc-content a {
        color: var(--vscode-textLink-foreground);
        text-decoration: none;
      }

      .doc-content a:hover {
        color: var(--vscode-textLink-activeForeground);
        text-decoration: underline;
      }

      .doc-content code {
        background: var(--vscode-textCodeBlock-background);
        padding: 2px 6px;
        border-radius: var(--webview-radius-sm);
        font-family: var(--webview-mono-font-family);
        font-size: 0.9em;
      }

      .doc-content pre {
        background: var(--vscode-textCodeBlock-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: var(--webview-radius-md);
        padding: var(--webview-space-md);
        overflow-x: auto;
      }

      .doc-content blockquote {
        border-left: 4px solid var(--vscode-textBlockQuote-border);
        background: var(--vscode-textBlockQuote-background);
        margin: var(--webview-space-md) 0;
        padding: var(--webview-space-sm) var(--webview-space-lg);
      }

      .doc-content table {
        border-collapse: collapse;
        width: 100%;
        margin: var(--webview-space-lg) 0;
      }

      .doc-content th, .doc-content td {
        border: 1px solid var(--vscode-panel-border);
        padding: var(--webview-space-sm) var(--webview-space-md);
        text-align: left;
      }

      .doc-content th {
        background: var(--vscode-editor-inactiveSelectionBackground);
        font-weight: 600;
      }
    `;

    const head = WebviewHelper.getHtmlHead(
      webview,
      extensionUri,
      `${file.name}`,
      additionalStyles,
      nonce
    );

    // Document type badge
    const docTypeBadge = this.getDocumentTypeBadge(docType);

    return `<!DOCTYPE html>
<html lang="ja">
${head}
<body>
  <div class="webview-header">
    <h1>${WebviewHelper.escapeHtml(event.summary || '(No title)')}</h1>
    <div class="webview-meta">
      <span class="meta-item source-calendar">📅 Google Calendar</span>
      ${docTypeBadge}
      <span class="meeting-time-badge">🕒 ${WebviewHelper.escapeHtml(timeStr)}</span>
      <a href="#" class="external-link link-calendar" id="openInBrowserBtn">Google Docs で開く</a>
      <a href="#" class="external-link" id="copyMarkdownBtn">Markdown をコピー</a>
      <a href="#" class="external-link" id="addToTodoBtn">+ TODO に追加</a>
    </div>
  </div>

  ${
    attendees.length > 0
      ? `<div class="meeting-info-section">
          <div class="meeting-info-row">
            <span class="meeting-info-label">👥 参加者</span>
            <div class="attendee-list">
              ${attendees.map((a) => `<span class="attendee-chip">${a}</span>`).join('')}
            </div>
          </div>
        </div>`
      : ''
  }

  <div class="doc-content">
    ${sanitizeGoogleHtml(htmlContent)}
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.addEventListener('click', (event) => {
      const target = event.target;

      if (target.closest('#openInBrowserBtn')) {
        event.preventDefault();
        vscode.postMessage({
          command: 'openExternal',
          url: ${JSON.stringify(file.webViewLink || '')}
        });
        return;
      }

      if (target.closest('#copyMarkdownBtn')) {
        event.preventDefault();
        const content = document.querySelector('.doc-content')?.innerText || '';
        vscode.postMessage({
          command: 'copyToClipboard',
          content: content
        });
        return;
      }

      if (target.closest('#addToTodoBtn')) {
        event.preventDefault();
        vscode.postMessage({
          command: 'addToTodo'
        });
        return;
      }
    });
  </script>
</body>
</html>`;
  }

  private static detectDocumentType(
    fileName: string,
    eventTitle: string
  ): 'gemini' | 'meeting-notes' | 'attachment' | 'other' {
    const lowerName = fileName.toLowerCase();

    // Gemini AI-generated notes
    if (
      lowerName.includes('gemini') ||
      lowerName.includes('ai ') ||
      lowerName.includes('summary by') ||
      lowerName.includes('ai summary')
    ) {
      return 'gemini';
    }

    // Meeting notes (title contains event name or common keywords)
    if (
      lowerName.includes('議事録') ||
      lowerName.includes('meeting notes') ||
      lowerName.includes('mtg notes') ||
      lowerName.includes('minutes') ||
      lowerName === eventTitle.toLowerCase() ||
      lowerName.startsWith(eventTitle.toLowerCase().substring(0, 10))
    ) {
      return 'meeting-notes';
    }

    // Attachments
    return 'attachment';
  }

  private static getDocumentTypeBadge(
    docType: 'gemini' | 'meeting-notes' | 'attachment' | 'other'
  ): string {
    switch (docType) {
      case 'gemini':
        return '<span class="meta-item doc-type-gemini">🤖 Gemini AI メモ</span>';
      case 'meeting-notes':
        return '<span class="meta-item doc-type-meeting">📝 会議メモ</span>';
      case 'attachment':
        return '<span class="meta-item doc-type-attachment">📎 添付ドキュメント</span>';
      default:
        return '<span class="meta-item">📄 ドキュメント</span>';
    }
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
