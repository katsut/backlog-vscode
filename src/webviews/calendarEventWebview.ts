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

    // Time
    let timeStr = '';
    if (event.start.dateTime && event.end.dateTime) {
      const start = new Date(event.start.dateTime);
      const end = new Date(event.end.dateTime);
      const dateFmt = `${start.getFullYear()}/${start.getMonth() + 1}/${start.getDate()}`;
      const tf = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
      timeStr = `${dateFmt} ${tf(start)} – ${tf(end)}`;
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
      ? `<div class="section"><h2>Description</h2><div class="description">${sanitizeDescription(
          event.description
        )}</div></div>`
      : '';

    // Links — use data-url + addEventListener (inline onclick blocked by CSP nonce)
    const links: string[] = [];
    if (event.hangoutLink) {
      links.push(
        `<a class="action-btn primary" href="#" data-url="${esc(
          event.hangoutLink
        )}">Meet に参加</a>`
      );
    }
    if (event.htmlLink) {
      links.push(
        `<a class="action-btn secondary" href="#" data-url="${esc(
          event.htmlLink
        )}">Google Calendar で開く</a>`
      );
    }

    const additionalStyles = `
      .event-header { margin-bottom: 20px; padding-bottom: 16px; border-bottom: 1px solid var(--vscode-panel-border); }
      .event-title { font-size: 1.4em; font-weight: 600; margin: 0 0 8px 0; }
      .event-time { color: var(--vscode-descriptionForeground); font-size: 0.95em; margin-bottom: 12px; }
      .section { margin-bottom: 20px; }
      .section h2 { font-size: 1em; font-weight: 600; margin: 0 0 8px 0; color: var(--vscode-descriptionForeground); }
      .attendees { display: flex; flex-wrap: wrap; gap: 4px; }
      .attendee-chip { display: inline-block; padding: 2px 8px; border-radius: 12px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 0.85em; }
      .description { line-height: 1.6; white-space: pre-wrap; }
      .description a { color: var(--vscode-textLink-foreground); }
      .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--vscode-panel-border); }
      .action-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border: 1px solid var(--vscode-button-border, var(--vscode-contrastBorder, transparent)); border-radius: 4px; cursor: pointer; font-size: 0.9em; font-family: inherit; text-decoration: none; }
      .action-btn.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
      .action-btn.primary:hover { background: var(--vscode-button-hoverBackground); }
      .action-btn.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
      .action-btn.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
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
  <div class="event-header">
    <h1 class="event-title">${esc(event.summary || '(No title)')}</h1>
    <div class="event-time">${esc(timeStr)}</div>
    ${
      attendees.length > 0
        ? `<div class="section"><h2>Attendees (${attendees.length})</h2><div class="attendees">${attendeeHtml}</div></div>`
        : ''
    }
  </div>
  ${descHtml}
  ${links.length > 0 ? `<div class="actions">${links.join('')}</div>` : ''}

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
