import * as vscode from 'vscode';
import { Entity } from 'backlog-js';
import { WebviewHelper } from './common';
import { MarkdownRenderer } from '../utils/markdownRenderer';

/**
 * Issue webview content generator
 */
export class IssueWebview {
  private static markdownRenderer = MarkdownRenderer.getInstance();

  /**
   * Generate issue webview content
   */
  static getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    issue: Entity.Issue.Issue,
    comments: Entity.Issue.Comment[],
    baseUrl?: string
  ): string {
    const nonce = WebviewHelper.getNonce();

    // Ensure baseUrl has https:// protocol
    const fullBaseUrl = baseUrl ? (baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`) : null;
    const issueUrl = fullBaseUrl && issue.issueKey ? `${fullBaseUrl}/view/${issue.issueKey}` : '#';

    // Render description as markdown if present
    const descriptionHtml = issue.description
      ? this.markdownRenderer.renderMarkdown(issue.description)
      : '';

    // Separate comments and change history
    const { regularComments, changeHistory } = this.categorizeComments(comments || []);

    // Render regular comments as markdown
    const commentsHtml = regularComments.map(comment => ({
      ...comment,
      contentHtml: this.markdownRenderer.renderMarkdown(this.normalizeCommentContent(comment.content))
    }));

    // Process change history
    const changeHistoryHtml = changeHistory.map((comment: Entity.Issue.Comment) => ({
      ...comment,
      changesHtml: this.formatChangeHistory(comment)
    }));

    const additionalStyles = `
        /* Issue-specific styles */
        .issue-description-content.markdown-content {
          background: transparent;
          border: none;
          padding: 0;
        }
        
        /* Fix potential conflicts with markdown content */
        .content-body .markdown-content h1,
        .content-body .markdown-content h2,
        .content-body .markdown-content h3,
        .content-body .markdown-content h4,
        .content-body .markdown-content h5,
        .content-body .markdown-content h6 {
          color: var(--vscode-foreground);
          font-weight: 600;
        }
        
        .content-body .markdown-content p {
          color: var(--vscode-foreground);
          line-height: 1.7;
        }
        
        .content-body .markdown-content ul,
        .content-body .markdown-content ol {
          color: var(--vscode-foreground);
        }
        
        .content-body .markdown-content li {
          color: var(--vscode-foreground);
        }
        
        .content-body .markdown-content blockquote {
          color: var(--vscode-descriptionForeground);
          border-left: 4px solid var(--vscode-textBlockQuote-border);
          background: var(--vscode-textBlockQuote-background);
        }
        
        .content-body .markdown-content code {
          background: var(--vscode-textCodeBlock-background);
          color: var(--vscode-textPreformat-foreground);
          border: 1px solid var(--vscode-panel-border);
        }
        
        .content-body .markdown-content pre {
          background: var(--vscode-textCodeBlock-background);
          border: 1px solid var(--vscode-panel-border);
        }
        
        .content-body .markdown-content a {
          color: var(--vscode-textLink-foreground);
        }
        
        .content-body .markdown-content a:hover {
          color: var(--vscode-textLink-activeForeground);
        }
        
        /* Change History Styles */
        .change-history {
          display: flex;
          flex-direction: column;
          gap: 0.5em;
        }
        
        .change-entry {
          background: var(--vscode-editor-inactiveSelectionBackground);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 6px;
          padding: 12px;
        }
        
        .change-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
          font-size: 0.9em;
        }
        
        .change-author {
          font-weight: 600;
          color: var(--vscode-foreground);
        }
        
        .change-date {
          color: var(--vscode-descriptionForeground);
          font-size: 0.85em;
        }
        
        .change-content {
          color: var(--vscode-foreground);
        }
        
        .change-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 0;
        }
        
        .change-icon {
          font-size: 1.1em;
          min-width: 20px;
        }
        
        .change-text {
          flex: 1;
          font-size: 0.9em;
        }
        
        .change-summary {
          color: var(--vscode-descriptionForeground);
          font-style: italic;
          text-align: center;
          padding: 8px;
        }
        
        .change-assignee .change-icon { color: #4a90e2; }
        .change-status .change-icon { color: #f39c12; }
        .change-priority .change-icon { color: #e74c3c; }
        
        /* Change details styles */
        .change-details-text {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        
        .change-field {
          font-weight: 600;
          font-size: 0.85em;
          color: var(--vscode-descriptionForeground);
        }
        
        .change-values {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.9em;
        }
        
        .change-from {
          background: var(--vscode-inputValidation-errorBackground);
          color: var(--vscode-inputValidation-errorForeground);
          padding: 2px 6px;
          border-radius: 3px;
          border: 1px solid var(--vscode-inputValidation-errorBorder);
        }
        
        .change-to {
          background: var(--vscode-inputValidation-infoBackground);
          color: var(--vscode-inputValidation-infoForeground);
          padding: 2px 6px;
          border-radius: 3px;
          border: 1px solid var(--vscode-inputValidation-infoBorder);
        }
        
        .change-arrow {
          color: var(--vscode-descriptionForeground);
          font-weight: bold;
        }
        
        .change-debug {
          font-size: 0.75em;
          color: var(--vscode-descriptionForeground);
          margin-top: 4px;
        }
        
        /* Unified diff styles (like Backlog) */
        .change-unified-diff {
          font-family: 'SF Mono', Monaco, Inconsolata, 'Roboto Mono', 'Consolas', 'Courier New', monospace;
          font-size: 0.85em;
          background: var(--vscode-textCodeBlock-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 4px;
          margin-top: 8px;
          overflow-x: auto;
        }
        
        .diff-line {
          display: flex;
          align-items: flex-start;
          padding: 2px 8px;
          margin: 0;
          white-space: pre-wrap;
          word-wrap: break-word;
        }
        
        .diff-line:hover {
          background: var(--vscode-list-hoverBackground);
        }
        
        .diff-removed {
          background: var(--vscode-diffEditor-removedTextBackground, rgba(255, 0, 0, 0.1));
          border-left: 3px solid var(--vscode-diffEditor-removedLineBackground, #ff0000);
        }
        
        .diff-added {
          background: var(--vscode-diffEditor-insertedTextBackground, rgba(0, 255, 0, 0.1));
          border-left: 3px solid var(--vscode-diffEditor-insertedLineBackground, #00ff00);
        }
        
        .diff-indicator {
          font-weight: bold;
          min-width: 20px;
          text-align: center;
          user-select: none;
          margin-right: 8px;
          flex-shrink: 0;
        }
        
        .diff-removed .diff-indicator {
          color: var(--vscode-diffEditor-removedTextForeground, #ff4444);
        }
        
        .diff-added .diff-indicator {
          color: var(--vscode-diffEditor-insertedTextForeground, #00aa00);
        }
        
        .diff-content {
          flex: 1;
          word-break: break-word;
          overflow-wrap: break-word;
          line-height: 1.4;
        }
        
        .change-no-diff {
          color: var(--vscode-descriptionForeground);
          font-style: italic;
          font-size: 0.9em;
        }
        
        .change-summary-text {
          font-size: 0.9em;
          color: var(--vscode-foreground);
        }
        
        .change-diff-details {
          margin-top: 8px;
        }
        
        .change-diff-details summary {
          cursor: pointer;
          color: var(--vscode-textLink-foreground);
          font-size: 0.85em;
          padding: 4px 0;
          user-select: none;
        }
        
        .change-diff-details summary:hover {
          color: var(--vscode-textLink-activeForeground);
        }
        
        .change-diff-details[open] summary {
          margin-bottom: 8px;
        }
        
        .diff-truncated {
          text-align: center;
          color: var(--vscode-descriptionForeground);
          font-style: italic;
          padding: 8px;
          background: var(--vscode-editor-inactiveSelectionBackground);
        }
    `;

    return `<!DOCTYPE html>
      <html lang="en">
      ${WebviewHelper.getHtmlHead(webview, extensionUri, `Issue ${issue.issueKey}`, additionalStyles, nonce)}
      <body>
        <div class="webview-header">
          <h1>
            ${WebviewHelper.escapeHtml(issue.summary)}
            <button class="refresh-button" id="refreshButton" title="Refresh issue content">
              <span class="codicon codicon-refresh"></span>
            </button>
          </h1>
          <div class="webview-meta">
            <span class="key-badge">${WebviewHelper.escapeHtml(issue.issueKey)}</span>
            <span class="status-badge ${this.getStatusClass(issue.status)}">${WebviewHelper.escapeHtml(issue.status.name)}</span>
            <span class="priority-badge ${this.getPriorityClass(issue.priority)}">${WebviewHelper.escapeHtml(issue.priority.name)}</span>
            ${fullBaseUrl && issue.id ? `<a href="#" class="external-link" data-url="${issueUrl}">🔗 Open in Backlog</a>` : ''}
          </div>
        </div>

        <div class="details-section">
          <div class="details-field">
            <label>Status:</label>
            <span>${WebviewHelper.escapeHtml(issue.status.name)}</span>
          </div>
          <div class="details-field">
            <label>Priority:</label>
            <span>${WebviewHelper.escapeHtml(issue.priority.name)}</span>
          </div>
          ${issue.assignee ? `
            <div class="details-field">
              <label>Assignee:</label>
              <span>${WebviewHelper.escapeHtml(issue.assignee.name)}</span>
            </div>
          ` : ''}
          ${issue.dueDate ? `
            <div class="details-field">
              <label>Due Date:</label>
              <span>${new Date(issue.dueDate).toLocaleDateString()}</span>
            </div>
          ` : ''}
        </div>

        ${descriptionHtml ? `
          <div class="content-section">
            <h3>Description</h3>
            <div class="content-body markdown-content">
              ${descriptionHtml}
            </div>
          </div>
        ` : ''}

        ${commentsHtml.length > 0 ? `
          <div class="content-section">
            <h3>Comments (${commentsHtml.length})</h3>
            ${commentsHtml.map(comment => `
              <div class="comment">
                <div class="comment-header">
                  <span class="comment-author">${WebviewHelper.escapeHtml(comment.createdUser.name)}</span>
                  <span class="comment-date">${new Date(comment.created).toLocaleDateString()}</span>
                </div>
                <div class="comment-content markdown-content">
                  ${comment.contentHtml}
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${changeHistoryHtml.length > 0 ? `
          <div class="content-section">
            <h3>Change History (${changeHistoryHtml.length})</h3>
            <div class="change-history">
              ${changeHistoryHtml.map(change => `
                <div class="change-entry">
                  <div class="change-header">
                    <span class="change-author">${WebviewHelper.escapeHtml(change.createdUser.name)}</span>
                    <span class="change-date">${new Date(change.created).toLocaleDateString()}</span>
                  </div>
                  <div class="change-content">
                    ${change.changesHtml}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          
          // Handle all clicks
          document.addEventListener('click', function(event) {
            const target = event.target;
            
            // Handle refresh button click
            if (target.closest('#refreshButton')) {
              event.preventDefault();
              event.stopPropagation();
              vscode.postMessage({
                command: 'refreshIssue',
                issueId: '${issue.id || ''}'
              });
              return false;
            }
            
            // Handle external link clicks
            const linkTarget = target.closest('a[data-url]');
            if (linkTarget) {
              event.preventDefault();
              event.stopPropagation();
              const url = linkTarget.getAttribute('data-url');
              if (url) {
                vscode.postMessage({
                  command: 'openExternal',
                  url: url
                });
              }
              return false;
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
   * Categorize comments into regular comments and change history
   */
  private static categorizeComments(comments: Entity.Issue.Comment[]): {
    regularComments: Entity.Issue.Comment[];
    changeHistory: Entity.Issue.Comment[];
  } {
    const regularComments: Entity.Issue.Comment[] = [];
    const changeHistory: Entity.Issue.Comment[] = [];

    comments.forEach((comment: Entity.Issue.Comment) => {
      if (this.isChangeHistoryComment(comment)) {
        changeHistory.push(comment);
      } else {
        regularComments.push(comment);
      }
    });

    return { regularComments, changeHistory };
  }

  /**
   * Check if a comment is a change history entry
   */
  private static isChangeHistoryComment(comment: Entity.Issue.Comment): boolean {
    // Backlogの変更履歴の特徴:
    // 1. コメント内容が空またはシステム生成
    // 2. changeLogプロパティが存在する場合がある
    // 3. 特定のパターンを含む（担当者変更、ステータス変更など）

    if (!comment.content || comment.content.trim() === '') {
      return true;
    }

    // システム生成の変更通知パターンをチェック
    const changePatterns = [
      /^担当者を.+に変更しました$/,
      /^状態を.+に変更しました$/,
      /^種別を.+に変更しました$/,
      /^優先度を.+に変更しました$/,
      /^期限日を.+に変更しました$/,
      /^マイルストーンを.+に変更しました$/,
      /^カテゴリーを.+に変更しました$/,
      /assigned to/i,
      /status changed/i,
      /priority changed/i,
      /due date changed/i
    ];

    return changePatterns.some(pattern => pattern.test(comment.content));
  }

  /**
   * Format change history comment
   */
  private static formatChangeHistory(comment: Entity.Issue.Comment): string {
    // Check all possible properties for change information
    const commentWithExtended = comment as Entity.Issue.Comment & {
      changeLog?: ChangeLogEntry[] | ChangeLogEntry;
      changes?: ChangeLogEntry[];
      notifications?: NotificationEntry[];
      statusId?: number;
      assigneeId?: number;
      priorityId?: number;
      summary?: string;
      description?: string;
    };

    // Try different property names for change information
    let changeData: ChangeLogEntry[] | null = null;
    if (commentWithExtended.changeLog && Array.isArray(commentWithExtended.changeLog)) {
      changeData = commentWithExtended.changeLog;
    } else if (commentWithExtended.changes && Array.isArray(commentWithExtended.changes)) {
      changeData = commentWithExtended.changes;
    } else if (commentWithExtended.changeLog && typeof commentWithExtended.changeLog === 'object') {
      changeData = [commentWithExtended.changeLog];
    }

    if (changeData && changeData.length > 0) {
      const changes = changeData.map((change: ChangeLogEntry) => {
        return this.formatIndividualChange(change);
      }).join('');

      return `<div class="change-details">${changes}</div>`;
    }

    // Check if there are notifications or other change indicators
    if (commentWithExtended.notifications && Array.isArray(commentWithExtended.notifications)) {
      const notifications = commentWithExtended.notifications.map((notif: NotificationEntry) => {
        return `<div class="change-item">
          <span class="change-icon">🔔</span>
          <span class="change-text">${WebviewHelper.escapeHtml(String(notif))}</span>
        </div>`;
      }).join('');
      return `<div class="change-details">${notifications}</div>`;
    }

    // If no specific change data but has other properties, show them
    const relevantProps: (keyof typeof commentWithExtended)[] = ['statusId', 'assigneeId', 'priorityId', 'summary', 'description'];
    const foundProps = relevantProps.filter(prop => commentWithExtended[prop] !== undefined);

    if (foundProps.length > 0) {
      const propDetails = foundProps.map(prop => `${String(prop)}: ${commentWithExtended[prop]}`).join(', ');
      return `<div class="change-item">
        <span class="change-icon">🔄</span>
        <span class="change-text">変更: ${WebviewHelper.escapeHtml(propDetails)}</span>
      </div>`;
    }

    if (!comment.content) {
      return `<div class="change-summary">
        システムによる変更 (${new Date(comment.created).toLocaleString()})
        <div class="change-debug">Comment ID: ${comment.id}</div>
      </div>`;
    }

    // Extract change information from comment content
    const content = comment.content.trim();

    // Format different types of changes
    if (content.includes('担当者') || content.includes('assigned')) {
      return `<div class="change-item change-assignee">
        <span class="change-icon">👤</span>
        <span class="change-text">${WebviewHelper.escapeHtml(content)}</span>
      </div>`;
    }

    if (content.includes('状態') || content.includes('status')) {
      return `<div class="change-item change-status">
        <span class="change-icon">📋</span>
        <span class="change-text">${WebviewHelper.escapeHtml(content)}</span>
      </div>`;
    }

    if (content.includes('優先度') || content.includes('priority')) {
      return `<div class="change-item change-priority">
        <span class="change-icon">⚡</span>
        <span class="change-text">${WebviewHelper.escapeHtml(content)}</span>
      </div>`;
    }

    // Default format for other changes
    return `<div class="change-item">
      <span class="change-icon">📝</span>
      <span class="change-text">${WebviewHelper.escapeHtml(content)}</span>
    </div>`;
  }

  /**
   * Format individual change from changeLog
   */
  private static formatIndividualChange(change: any): string {
    const field = change.field || change.name || change.type || 'unknown';
    const originalValue = change.originalValue || change.oldValue || change.from || '';
    const newValue = change.newValue || change.value || change.to || '';

    let icon = '📝';
    let changeClass = '';

    // Determine icon and class based on field type
    switch (field.toLowerCase()) {
      case 'assignee':
      case 'assigneeid':
      case '担当者':
        icon = '👤';
        changeClass = 'change-assignee';
        break;
      case 'status':
      case 'statusid':
      case '状態':
        icon = '📋';
        changeClass = 'change-status';
        break;
      case 'priority':
      case 'priorityid':
      case '優先度':
        icon = '⚡';
        changeClass = 'change-priority';
        break;
      case 'duedate':
      case '期限日':
        icon = '📅';
        changeClass = 'change-duedate';
        break;
      case 'summary':
      case 'タイトル':
        icon = '📝';
        changeClass = 'change-summary';
        break;
      case 'description':
      case '説明':
        icon = '📄';
        changeClass = 'change-description';
        break;
      default:
        icon = '🔄';
        changeClass = 'change-other';
    }

    const fromText = originalValue ? String(originalValue) : '';
    const toText = newValue ? String(newValue) : '';

    // Check if we have meaningful changes to display
    if (fromText === toText) {
      return `<div class="change-item ${changeClass}">
        <span class="change-icon">${icon}</span>
        <div class="change-details-text">
          <div class="change-field">${WebviewHelper.escapeHtml(field)}</div>
          <div class="change-no-diff">値に変更なし</div>
        </div>
      </div>`;
    }

    // Special handling for description and long text changes
    if ((field.toLowerCase() === 'description' || field.toLowerCase() === '説明') &&
      (fromText.length > 50 || toText.length > 50)) {
      return this.formatTextDiff(field, fromText, toText, icon, changeClass);
    }

    // Simple field changes (status, priority, etc.)
    return `<div class="change-item ${changeClass}">
      <span class="change-icon">${icon}</span>
      <div class="change-details-text">
        <div class="change-field">${WebviewHelper.escapeHtml(field)}</div>
        <div class="change-unified-diff">
          ${fromText ? `<div class="diff-line diff-removed">
            <span class="diff-indicator">-</span>
            <span class="diff-content">${WebviewHelper.escapeHtml(fromText)}</span>
          </div>` : ''}
          ${toText ? `<div class="diff-line diff-added">
            <span class="diff-indicator">+</span>
            <span class="diff-content">${WebviewHelper.escapeHtml(toText)}</span>
          </div>` : ''}
        </div>
      </div>
    </div>`;
  }

  /**
   * Format text diff in unified style (like Backlog)
   */
  private static formatTextDiff(field: string, fromText: string, toText: string, icon: string, changeClass: string): string {
    // Clean up text - trim and normalize whitespace
    const cleanFromText = fromText.trim().replace(/\n{3,}/g, '\n\n');
    const cleanToText = toText.trim().replace(/\n{3,}/g, '\n\n');

    // For long text, create a simple line-based diff
    const fromLines = cleanFromText.split('\n').filter(line => line.trim() !== '' || cleanFromText.includes('\n\n'));
    const toLines = cleanToText.split('\n').filter(line => line.trim() !== '' || cleanToText.includes('\n\n'));

    // Simple diff algorithm - mark lines as removed/added
    const diffLines: Array<{ type: 'removed' | 'added' | 'context', content: string }> = [];

    // Add removed lines (excluding empty lines unless they're meaningful)
    fromLines.forEach(line => {
      if (!toLines.includes(line) && (line.trim() !== '' || line.length > 0)) {
        diffLines.push({ type: 'removed', content: line });
      }
    });

    // Add added lines (excluding empty lines unless they're meaningful)
    toLines.forEach(line => {
      if (!fromLines.includes(line) && (line.trim() !== '' || line.length > 0)) {
        diffLines.push({ type: 'added', content: line });
      }
    });

    // Remove consecutive empty line changes
    const filteredDiffLines = this.filterConsecutiveEmptyLines(diffLines);

    // If too many changes, show summary instead
    if (filteredDiffLines.length > 10) {
      const fromLength = cleanFromText.length;
      const toLength = cleanToText.length;

      return `<div class="change-item ${changeClass}">
        <span class="change-icon">${icon}</span>
        <div class="change-details-text">
          <div class="change-field">${WebviewHelper.escapeHtml(field)}</div>
          <div class="change-summary-text">
            内容が更新されました (${fromLength} → ${toLength} 文字)
            <details class="change-diff-details">
              <summary>差分を表示</summary>
              <div class="change-unified-diff">
                ${filteredDiffLines.slice(0, 20).map(line => `
                  <div class="diff-line diff-${line.type}">
                    <span class="diff-indicator">${line.type === 'removed' ? '-' : '+'}</span>
                    <span class="diff-content">${WebviewHelper.escapeHtml(line.content.substring(0, 200))}</span>
                  </div>
                `).join('')}
                ${filteredDiffLines.length > 20 ? '<div class="diff-truncated">... (truncated)</div>' : ''}
              </div>
            </details>
          </div>
        </div>
      </div>`;
    }

    // If no meaningful changes after filtering
    if (filteredDiffLines.length === 0) {
      return `<div class="change-item ${changeClass}">
        <span class="change-icon">${icon}</span>
        <div class="change-details-text">
          <div class="change-field">${WebviewHelper.escapeHtml(field)}</div>
          <div class="change-summary-text">
            内容が更新されました（主に空白文字や改行の変更）
          </div>
        </div>
      </div>`;
    }

    return `<div class="change-item ${changeClass}">
      <span class="change-icon">${icon}</span>
      <div class="change-details-text">
        <div class="change-field">${WebviewHelper.escapeHtml(field)}</div>
        <div class="change-unified-diff">
          ${filteredDiffLines.map(line => `
            <div class="diff-line diff-${line.type}">
              <span class="diff-indicator">${line.type === 'removed' ? '-' : '+'}</span>
              <span class="diff-content">${WebviewHelper.escapeHtml(line.content || '(空行)')}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>`;
  }

  /**
   * Filter consecutive empty lines to reduce noise in diff
   */
  private static filterConsecutiveEmptyLines(diffLines: Array<{ type: 'removed' | 'added' | 'context', content: string }>): Array<{ type: 'removed' | 'added' | 'context', content: string }> {
    const filtered: Array<{ type: 'removed' | 'added' | 'context', content: string }> = [];
    let consecutiveEmptyCount = 0;

    for (let i = 0; i < diffLines.length; i++) {
      const line = diffLines[i];
      const isEmpty = line.content.trim() === '';

      if (isEmpty) {
        consecutiveEmptyCount++;
        // Only show first 2 consecutive empty lines
        if (consecutiveEmptyCount <= 2) {
          filtered.push(line);
        } else if (consecutiveEmptyCount === 3) {
          // Add a summary line for multiple empty lines
          filtered.push({
            type: line.type,
            content: `... (${consecutiveEmptyCount - 2} more empty lines)`
          });
        }
        // Skip additional consecutive empty lines
      } else {
        consecutiveEmptyCount = 0;
        filtered.push(line);
      }
    }

    return filtered;
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
