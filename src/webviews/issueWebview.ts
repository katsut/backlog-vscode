import * as vscode from 'vscode';
import { Entity } from 'backlog-js';
import { WebviewHelper } from './common';
import { MarkdownRenderer } from '../utils/markdownRenderer';
import { BacklogApiService } from '../services/backlogApi';
import { resolveBacklogImages } from '../utils/imageResolver';

/**
 * Issue webview content generator
 */
export class IssueWebview {
  private static markdownRenderer = MarkdownRenderer.getInstance();

  /**
   * Generate issue webview content
   */
  static async getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    issue: Entity.Issue.Issue,
    comments: Entity.Issue.Comment[],
    baseUrl?: string,
    backlogApi?: BacklogApiService
  ): Promise<string> {
    const nonce = WebviewHelper.getNonce();

    // Ensure baseUrl has https:// protocol
    const fullBaseUrl = baseUrl
      ? baseUrl.startsWith('http')
        ? baseUrl
        : `https://${baseUrl}`
      : null;
    const issueUrl = fullBaseUrl && issue.issueKey ? `${fullBaseUrl}/view/${issue.issueKey}` : '#';

    // Resolve Backlog image URLs in description
    const description = await resolveBacklogImages(issue.description || '', backlogApi);

    // Render description as markdown if present
    const descriptionHtml = description ? this.markdownRenderer.renderMarkdown(description) : '';

    // Extract additional issue fields
    const issueAny = issue as any;
    const issueTypeName = (issue.issueType as { name?: string })?.name || '';
    const milestones = Array.isArray(issueAny.milestone)
      ? issueAny.milestone.map((m: any) => m.name).filter(Boolean)
      : [];
    const categories = Array.isArray(issueAny.category)
      ? issueAny.category.map((c: any) => c.name).filter(Boolean)
      : [];

    // Merge comments and change history into unified timeline
    const timeline = this.buildTimeline(comments || []);
    const timelineHtml = await Promise.all(
      timeline.map(async (entry) => {
        if (entry.type === 'comment') {
          const content = await resolveBacklogImages(
            this.normalizeCommentContent(entry.comment!.content),
            backlogApi
          );
          return { ...entry, contentHtml: this.markdownRenderer.renderMarkdown(content) };
        } else if (entry.type === 'mixed') {
          const content = await resolveBacklogImages(
            this.normalizeCommentContent(entry.comment!.content),
            backlogApi
          );
          return {
            ...entry,
            contentHtml: this.markdownRenderer.renderMarkdown(content),
            changesHtml: this.formatChangeHistory(entry.comment!),
          };
        }
        return { ...entry, changesHtml: this.formatChangeHistory(entry.comment!) };
      })
    );

    const additionalStyles = `
        /* Issue details grid */
        .issue-details-grid {
          display: grid;
          grid-template-columns: auto 1fr auto 1fr;
          gap: 6px 12px;
          padding: 12px 16px;
          background: var(--vscode-editor-inactiveSelectionBackground);
          border-radius: 6px;
          margin-bottom: 16px;
          font-size: 0.9em;
        }
        .issue-details-grid .detail-label {
          color: var(--vscode-descriptionForeground);
          font-weight: 500;
          white-space: nowrap;
        }
        .issue-details-grid .detail-value {
          color: var(--vscode-foreground);
        }

        /* Description */
        .issue-description { margin-bottom: 16px; }
        .issue-description h3 {
          font-size: 1em;
          font-weight: 600;
          margin: 0 0 8px 0;
          padding-bottom: 6px;
          border-bottom: 1px solid var(--vscode-panel-border);
        }
        .issue-description .markdown-content {
          background: transparent;
          border: none;
          padding: 0;
        }
        .issue-description .markdown-content p { line-height: 1.6; }
        .issue-description .markdown-content a { color: var(--vscode-textLink-foreground); }
        .issue-description .markdown-content a:hover { color: var(--vscode-textLink-activeForeground); }
        .issue-description .markdown-content blockquote {
          border-left: 3px solid var(--vscode-textBlockQuote-border);
          background: var(--vscode-textBlockQuote-background);
          margin: 8px 0;
          padding: 4px 12px;
        }
        .issue-description .markdown-content code {
          background: var(--vscode-textCodeBlock-background);
          padding: 1px 4px;
          border-radius: 3px;
          font-size: 0.9em;
        }
        .issue-description .markdown-content pre {
          background: var(--vscode-textCodeBlock-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 4px;
          padding: 8px 12px;
        }

        /* Unified timeline */
        .timeline-section { margin-top: 16px; }
        .timeline-section h3 {
          font-size: 1em;
          margin: 0 0 12px 0;
          padding-bottom: 6px;
          border-bottom: 1px solid var(--vscode-panel-border);
        }
        .timeline-entry {
          padding: 10px 0;
          border-bottom: 1px solid var(--vscode-panel-border);
        }
        .timeline-entry:last-child { border-bottom: none; }
        .timeline-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
          font-size: 0.85em;
        }
        .timeline-author {
          font-weight: 600;
          color: var(--vscode-textLink-foreground);
        }
        .timeline-date {
          color: var(--vscode-descriptionForeground);
        }
        .timeline-content .markdown-content {
          background: transparent;
          border: none;
          padding: 0;
        }
        .timeline-content .markdown-content p { line-height: 1.6; margin: 4px 0; }
        .timeline-content .markdown-content a { color: var(--vscode-textLink-foreground); }

        /* Change entries in timeline */
        .timeline-changes {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          font-size: 0.85em;
        }
        .change-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background: var(--vscode-editor-inactiveSelectionBackground);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 4px;
          padding: 2px 8px;
        }
        .change-chip .field-name {
          color: var(--vscode-descriptionForeground);
          font-weight: 500;
        }
        .change-chip .old-val {
          text-decoration: line-through;
          color: var(--vscode-descriptionForeground);
          opacity: 0.7;
        }
        .change-chip .new-val {
          color: var(--vscode-foreground);
          font-weight: 500;
        }
        .change-chip .arrow { color: var(--vscode-descriptionForeground); }

        /* Description diff in timeline */
        .desc-change-summary {
          font-size: 0.85em;
          color: var(--vscode-descriptionForeground);
          font-style: italic;
        }
        .change-diff-details { margin-top: 4px; }
        .change-diff-details summary {
          cursor: pointer;
          color: var(--vscode-textLink-foreground);
          font-size: 0.85em;
          user-select: none;
        }
        .change-diff-details summary:hover { color: var(--vscode-textLink-activeForeground); }
        .change-unified-diff {
          font-family: var(--webview-mono-font-family);
          font-size: 0.85em;
          background: var(--vscode-textCodeBlock-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 4px;
          margin-top: 4px;
          overflow-x: auto;
        }
        .diff-line {
          display: flex;
          padding: 1px 8px;
          white-space: pre-wrap;
          word-wrap: break-word;
        }
        .diff-removed {
          background: var(--vscode-diffEditor-removedTextBackground, rgba(255, 0, 0, 0.1));
        }
        .diff-added {
          background: var(--vscode-diffEditor-insertedTextBackground, rgba(0, 255, 0, 0.1));
        }
        .diff-indicator {
          font-weight: bold;
          min-width: 16px;
          text-align: center;
          user-select: none;
          flex-shrink: 0;
        }
        .diff-removed .diff-indicator { color: var(--vscode-diffEditor-removedTextForeground, #ff4444); }
        .diff-added .diff-indicator { color: var(--vscode-diffEditor-insertedTextForeground, #00aa00); }
        .diff-content { flex: 1; word-break: break-word; line-height: 1.4; }
        .diff-truncated {
          text-align: center;
          color: var(--vscode-descriptionForeground);
          font-style: italic;
          padding: 4px;
        }
    `;

    // Build details grid items
    const detailItems: Array<{ label: string; value: string }> = [];
    if (issueTypeName) {
      detailItems.push({ label: '種別', value: issueTypeName });
    }
    detailItems.push({ label: '担当', value: issue.assignee?.name || '未割当' });
    if (issue.dueDate) {
      detailItems.push({
        label: '期日',
        value: new Date(issue.dueDate).toLocaleDateString('ja-JP'),
      });
    }
    if (milestones.length > 0) {
      detailItems.push({ label: 'マイルストーン', value: milestones.join(', ') });
    }
    if (categories.length > 0) {
      detailItems.push({ label: 'カテゴリ', value: categories.join(', ') });
    }

    const detailsGridHtml = detailItems
      .map(
        (d) =>
          `<span class="detail-label">${WebviewHelper.escapeHtml(
            d.label
          )}</span><span class="detail-value">${WebviewHelper.escapeHtml(d.value)}</span>`
      )
      .join('');

    return `<!DOCTYPE html>
      <html lang="ja">
      ${WebviewHelper.getHtmlHead(
        webview,
        extensionUri,
        `Issue ${issue.issueKey}`,
        additionalStyles,
        nonce
      )}
      <body>
        <div class="webview-header">
          <h1>
            ${WebviewHelper.escapeHtml(issue.summary)}
            <button class="refresh-button" id="refreshButton" title="更新">
              <span class="codicon codicon-refresh"></span>
            </button>
          </h1>
          <div class="webview-meta">
            <span class="meta-item">⚡ Backlog</span>
            <span class="key-badge">${WebviewHelper.escapeHtml(issue.issueKey)}</span>
            <span class="status-badge ${this.getStatusClass(
              issue.status
            )}">${WebviewHelper.escapeHtml(issue.status.name)}</span>
            <span class="priority-badge ${this.getPriorityClass(
              issue.priority
            )}">${WebviewHelper.escapeHtml(issue.priority.name)}</span>
            ${
              fullBaseUrl && issue.id
                ? `<a href="#" class="external-link" data-url="${issueUrl}">Open in Backlog</a>`
                : ''
            }
            <a href="#" class="external-link" id="addToTodoBtn">+ TODO</a>
            <a href="#" class="external-link" id="addStarBtn" title="スターを付ける">&#9733; Star${
              (issue as any).stars?.length ? ` (${(issue as any).stars.length})` : ''
            }</a>
          </div>
        </div>

        <div class="issue-details-grid">
          ${detailsGridHtml}
        </div>

        ${
          descriptionHtml
            ? `
          <div class="issue-description">
            <h3>説明</h3>
            <div class="markdown-content">
              ${descriptionHtml}
            </div>
          </div>
        `
            : ''
        }

        ${
          timelineHtml.length > 0
            ? `
          <div class="timeline-section">
            <h3>コメント・変更履歴 (${timelineHtml.length})</h3>
            ${timelineHtml
              .map((entry) => {
                const author = WebviewHelper.escapeHtml(entry.comment!.createdUser.name);
                const date = new Date(entry.comment!.created).toLocaleDateString('ja-JP');
                if (entry.type === 'comment') {
                  return `<div class="timeline-entry">
                    <div class="timeline-header">
                      <span class="timeline-author">${author}</span>
                      <span class="timeline-date">${date}</span>
                    </div>
                    <div class="timeline-content markdown-content">${
                      (entry as any).contentHtml
                    }</div>
                  </div>`;
                } else if (entry.type === 'change') {
                  return `<div class="timeline-entry">
                    <div class="timeline-header">
                      <span class="timeline-author">${author}</span>
                      <span class="timeline-date">${date}</span>
                    </div>
                    <div class="timeline-changes">${(entry as any).changesHtml}</div>
                  </div>`;
                } else {
                  // mixed: comment + changes
                  return `<div class="timeline-entry">
                    <div class="timeline-header">
                      <span class="timeline-author">${author}</span>
                      <span class="timeline-date">${date}</span>
                    </div>
                    <div class="timeline-changes">${(entry as any).changesHtml}</div>
                    <div class="timeline-content markdown-content">${
                      (entry as any).contentHtml
                    }</div>
                  </div>`;
                }
              })
              .join('')}
          </div>
        `
            : ''
        }

        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();

          document.addEventListener('click', function(event) {
            const target = event.target;

            if (target.closest('#refreshButton')) {
              event.preventDefault();
              vscode.postMessage({ command: 'refreshIssue', issueId: '${issue.id || ''}' });
              return;
            }

            if (target.closest('#addToTodoBtn')) {
              event.preventDefault();
              vscode.postMessage({ command: 'addToTodo' });
              return;
            }

            if (target.closest('#addStarBtn')) {
              event.preventDefault();
              vscode.postMessage({ command: 'addStar', issueId: ${issue.id} });
              return;
            }

            const linkTarget = target.closest('a[data-url]');
            if (linkTarget) {
              event.preventDefault();
              const url = linkTarget.getAttribute('data-url');
              if (url) {
                vscode.postMessage({ command: 'openExternal', url: url });
              }
            }
          });
        </script>
      </body>
      </html>`;
  }

  /**
   * Get CSS class for status badge
   */
  private static getStatusClass(status: Entity.Project.ProjectStatus): string {
    if (!status) {
      return '';
    }

    const name = status.name.toLowerCase();
    if (name.includes('open') || name.includes('オープン')) {
      return 'open';
    }
    if (name.includes('progress') || name.includes('処理中')) {
      return 'in-progress';
    }
    if (name.includes('resolved') || name.includes('解決')) {
      return 'resolved';
    }
    if (name.includes('closed') || name.includes('クローズ')) {
      return 'closed';
    }
    return '';
  }

  /**
   * Get CSS class for priority badge
   */
  private static getPriorityClass(priority: Entity.Issue.Priority): string {
    if (!priority) {
      return '';
    }
    const name = priority.name.toLowerCase();
    if (name.includes('high') || name.includes('高')) {
      return 'high';
    }
    if (name.includes('medium') || name.includes('中')) {
      return 'medium';
    }
    if (name.includes('low') || name.includes('低')) {
      return 'low';
    }
    return '';
  }

  /**
   * Build a unified chronological timeline from comments.
   * Each entry is either 'comment', 'change', or 'mixed' (has both changeLog and text content).
   */
  private static buildTimeline(
    comments: Entity.Issue.Comment[]
  ): Array<{ type: 'comment' | 'change' | 'mixed'; comment: Entity.Issue.Comment }> {
    return comments.map((c) => {
      const hasChangeLog = Array.isArray((c as any).changeLog) && (c as any).changeLog.length > 0;
      const hasContent = !!(c.content && c.content.trim());
      if (hasChangeLog && hasContent) {
        return { type: 'mixed' as const, comment: c };
      } else if (hasChangeLog) {
        return { type: 'change' as const, comment: c };
      } else {
        return { type: 'comment' as const, comment: c };
      }
    });
  }

  /**
   * Format change history as compact chips
   */
  private static formatChangeHistory(comment: Entity.Issue.Comment): string {
    const changeLog = (comment as any).changeLog as any[] | undefined;
    if (!changeLog || !Array.isArray(changeLog) || changeLog.length === 0) {
      return '<span class="desc-change-summary">変更あり</span>';
    }

    return changeLog
      .map((change: any) => {
        const field = change.field || 'unknown';
        const oldVal = change.originalValue || '';
        const newVal = change.newValue || '';

        // Description changes: just show summary with expandable diff
        if (field.toLowerCase() === 'description' || field.toLowerCase() === '説明') {
          return this.formatDescriptionChange(oldVal, newVal);
        }

        // Simple field changes as chips
        if (oldVal && newVal) {
          return `<span class="change-chip">
            <span class="field-name">${WebviewHelper.escapeHtml(field)}</span>
            <span class="old-val">${WebviewHelper.escapeHtml(this.truncate(oldVal, 40))}</span>
            <span class="arrow">&rarr;</span>
            <span class="new-val">${WebviewHelper.escapeHtml(this.truncate(newVal, 40))}</span>
          </span>`;
        } else if (newVal) {
          return `<span class="change-chip">
            <span class="field-name">${WebviewHelper.escapeHtml(field)}</span>
            <span class="arrow">&rarr;</span>
            <span class="new-val">${WebviewHelper.escapeHtml(this.truncate(newVal, 40))}</span>
          </span>`;
        }
        return `<span class="change-chip"><span class="field-name">${WebviewHelper.escapeHtml(
          field
        )}</span> を変更</span>`;
      })
      .join('');
  }

  private static truncate(s: string, max: number): string {
    return s.length > max ? s.slice(0, max) + '...' : s;
  }

  /**
   * Format description change with expandable diff
   */
  private static formatDescriptionChange(oldVal: string, newVal: string): string {
    if (!oldVal && !newVal) {
      return '<span class="desc-change-summary">説明を変更</span>';
    }

    const fromLines = (oldVal || '').trim().split('\n');
    const toLines = (newVal || '').trim().split('\n');
    const removed = fromLines.filter((l) => !toLines.includes(l) && l.trim());
    const added = toLines.filter((l) => !fromLines.includes(l) && l.trim());
    const diffLines = [
      ...removed.slice(0, 10).map((l) => ({ type: 'removed', content: l })),
      ...added.slice(0, 10).map((l) => ({ type: 'added', content: l })),
    ];

    if (diffLines.length === 0) {
      return '<span class="desc-change-summary">説明を更新（書式変更）</span>';
    }

    const total = removed.length + added.length;
    return `<span class="desc-change-summary">説明を更新</span>
      <details class="change-diff-details">
        <summary>差分を表示 (-${removed.length} +${added.length})</summary>
        <div class="change-unified-diff">
          ${diffLines
            .map(
              (l) =>
                `<div class="diff-line diff-${l.type}"><span class="diff-indicator">${
                  l.type === 'removed' ? '-' : '+'
                }</span><span class="diff-content">${WebviewHelper.escapeHtml(
                  this.truncate(l.content, 200)
                )}</span></div>`
            )
            .join('')}
          ${total > 20 ? '<div class="diff-truncated">... (省略)</div>' : ''}
        </div>
      </details>`;
  }

  /**
   * Normalize comment content to remove excessive whitespace and line breaks
   */
  private static normalizeCommentContent(content: string): string {
    if (!content) {
      return content;
    }

    // Trim leading and trailing whitespace
    let normalized = content.trim();

    // Replace lines with only spaces, tabs, or other whitespace characters with empty lines
    normalized = normalized.replace(/^[ \t\r\f\v]+$/gm, '');

    // Replace multiple consecutive empty lines with maximum 1 empty line
    normalized = normalized.replace(/\n\n+/g, '\n\n');

    // Additional cleanup: remove trailing spaces from each line
    normalized = normalized.replace(/[ \t]+$/gm, '');

    return normalized;
  }
}
