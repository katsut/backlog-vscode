import * as vscode from 'vscode';
import { WebviewHelper } from './common';
import { GoogleCalendarEvent } from '../types/google';

export class CalendarEventWebview {
  static getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    event: GoogleCalendarEvent
  ): string {
    const nonce = WebviewHelper.getNonce();
    const esc = WebviewHelper.escapeHtml;

    // Time — extract directly from ISO string to avoid UTC conversion
    let timeStr = '';
    if (event.start.dateTime && event.end.dateTime) {
      const datePart = event.start.dateTime.slice(0, 10).replace(/-/g, '/');
      const startTime = event.start.dateTime.slice(11, 16);
      const endTime = event.end.dateTime.slice(11, 16);
      timeStr = `${datePart} ${startTime} – ${endTime}`;
    } else if (event.start.date) {
      timeStr = event.start.date + ' (終日)';
    }

    // Attendees
    const attendees = (event.attendees || []).filter((a) => !a.self);
    const statusIcon: Record<string, string> = {
      accepted: '✓',
      declined: '✗',
      tentative: '?',
      needsAction: '–',
    };

    const attendeeHtml = attendees
      .map((a) => {
        const name = esc(a.displayName || a.email);
        const icon = statusIcon[a.responseStatus] || '';
        return `<span class="attendee-chip" title="${esc(a.email)}">${icon} ${name}</span>`;
      })
      .join('');

    // Description
    const descHtml = event.description
      ? `<div class="content-section">
          <h3>説明</h3>
          <div class="event-description">${sanitizeDescription(event.description)}</div>
        </div>`
      : '';

    // Links — use data-url + addEventListener (inline onclick blocked by CSP nonce)
    const links: string[] = [];
    if (event.hangoutLink) {
      links.push(
        `<a class="external-link link-calendar" href="#" data-url="${esc(
          event.hangoutLink
        )}">🎥 Meet に参加</a>`
      );
    }
    if (event.htmlLink) {
      links.push(
        `<a class="external-link link-calendar" href="#" data-url="${esc(
          event.htmlLink
        )}">Google Calendar で開く</a>`
      );
    }

    const additionalStyles = `
      /* Calendar Event specific styles */
      .event-info-card {
        background: var(--vscode-editor-inactiveSelectionBackground);
        border-left: 4px solid var(--calendar-color);
        border-radius: 0 var(--webview-radius-lg) var(--webview-radius-lg) 0;
        padding: var(--webview-space-lg);
        margin: var(--webview-space-xl) 0;
        box-shadow: var(--webview-shadow-md);
      }

      .event-time-badge {
        display: inline-flex;
        align-items: center;
        gap: var(--webview-space-xs);
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        padding: var(--webview-space-xs) var(--webview-space-md);
        border-radius: var(--webview-radius-md);
        font-size: var(--webview-font-size-sm);
        font-weight: 600;
        margin-bottom: var(--webview-space-md);
      }

      .event-attendees-section {
        margin-top: var(--webview-space-md);
        padding-top: var(--webview-space-md);
        border-top: 1px solid var(--vscode-panel-border);
      }

      .event-attendees-label {
        font-weight: 600;
        font-size: var(--webview-font-size-sm);
        color: var(--vscode-descriptionForeground);
        margin-bottom: var(--webview-space-sm);
      }

      .event-description {
        line-height: 1.7;
        font-family: var(--webview-font-family);
        color: var(--vscode-foreground);
        padding: var(--webview-space-md);
        background: var(--vscode-textCodeBlock-background);
        border-radius: var(--webview-radius-md);
      }

      .event-description a {
        color: var(--vscode-textLink-foreground);
        text-decoration: none;
      }

      .event-description a:hover {
        color: var(--vscode-textLink-activeForeground);
        text-decoration: underline;
      }

      .event-description br {
        line-height: 2;
      }

      .event-actions {
        display: flex;
        gap: var(--webview-space-sm);
        flex-wrap: wrap;
        margin-top: var(--webview-space-xl);
        padding-top: var(--webview-space-lg);
        border-top: 1px solid var(--vscode-panel-border);
      }
    `;

    const head = WebviewHelper.getHtmlHead(
      webview,
      extensionUri,
      event.summary || 'Event',
      additionalStyles,
      nonce
    );

    return `<!DOCTYPE html>
<html lang="ja">
${head}
<body>
  <div class="webview-header">
    <h1>${esc(event.summary || '(No title)')}</h1>
    <div class="webview-meta">
      <span class="meta-item source-calendar">📅 Google Calendar</span>
      ${links.join('')}
    </div>
  </div>

  <div class="event-info-card">
    <div class="event-time-badge">🕒 ${esc(timeStr)}</div>
    ${
      attendees.length > 0
        ? `<div class="event-attendees-section">
            <div class="event-attendees-label">👥 参加者 (${attendees.length})</div>
            <div class="attendee-list">${attendeeHtml}</div>
          </div>`
        : ''
    }
  </div>

  ${descHtml}

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.querySelectorAll('[data-url]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        vscode.postMessage({ command: 'openExternal', url: el.dataset.url });
      });
    });
  </script>
</body>
</html>`;
  }
}

function sanitizeDescription(html: string): string {
  // Google Calendar descriptions can contain HTML links
  // Keep <a> and <br> tags, strip everything else
  let cleaned = html.replace(/<br\s*\/?>/gi, '\n');
  cleaned = cleaned.replace(/<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '<a href="$1">$2</a>');
  cleaned = cleaned.replace(/<(?!\/?a)[^>]+>/g, '');
  // Convert newlines back to <br>
  cleaned = cleaned.replace(/\n/g, '<br>');
  return cleaned;
}
