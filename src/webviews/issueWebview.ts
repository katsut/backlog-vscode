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
    const issueUrl = baseUrl && issue.issueKey ? `${baseUrl}/view/${issue.issueKey}` : '#';

    // Render description as markdown if present
    const descriptionHtml = issue.description
      ? this.markdownRenderer.renderMarkdown(issue.description)
      : '';

    // Render comments as markdown
    const commentsHtml = comments && comments.length > 0
      ? comments.map(comment => ({
        ...comment,
        contentHtml: this.markdownRenderer.renderMarkdown(comment.content)
      }))
      : [];

    const additionalStyles = `
        ${this.markdownRenderer.getMarkdownStyles()}
        
        .issue-header {
          border-bottom: 2px solid var(--vscode-panel-border);
          padding-bottom: 16px;
          margin-bottom: 24px;
        }
        
        .issue-header h1 {
          margin: 0 0 12px 0;
          color: var(--vscode-foreground);
          font-size: 1.8em;
        }
        
        .issue-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
        }
        
        .issue-key {
          background: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
          padding: 4px 8px;
          border-radius: 4px;
          font-family: var(--vscode-editor-font-family);
          font-weight: 500;
        }
        
        .status-badge, .priority-badge {
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.85em;
          font-weight: 500;
        }
        
        .status-badge.open { background: #28a745; color: white; }
        .status-badge.in-progress { background: #ffc107; color: black; }
        .status-badge.resolved { background: #6f42c1; color: white; }
        .status-badge.closed { background: #6c757d; color: white; }
        
        .priority-badge.high { background: #dc3545; color: white; }
        .priority-badge.medium { background: #fd7e14; color: white; }
        .priority-badge.low { background: #20c997; color: white; }
        
        .issue-details {
          background: var(--vscode-editor-inactiveSelectionBackground);
          border-left: 4px solid var(--vscode-textBlockQuote-border);
          padding: 16px;
          margin: 20px 0;
          border-radius: 0 6px 6px 0;
        }
        
        .issue-field {
          margin-bottom: 8px;
        }
        
        .issue-field label {
          font-weight: 500;
          color: var(--vscode-foreground);
          margin-right: 8px;
        }
        
        .issue-description {
          margin: 24px 0;
        }
        
        .issue-description h3 {
          color: var(--vscode-foreground);
          margin-bottom: 16px;
          font-size: 1.2em;
        }
        
        .issue-description-content {
          background: var(--vscode-textCodeBlock-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 6px;
          padding: 16px;
        }
        
        .issue-comments {
          margin-top: 32px;
        }
        
        .issue-comments h3 {
          color: var(--vscode-foreground);
          margin-bottom: 20px;
          font-size: 1.2em;
        }
        
        .comment {
          background: var(--vscode-editor-inactiveSelectionBackground);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 6px;
          margin-bottom: 16px;
          overflow: hidden;
        }
        
        .comment-header {
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          padding: 12px 16px;
          border-bottom: 1px solid var(--vscode-panel-border);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .comment-author {
          font-weight: 500;
        }
        
        .comment-date {
          font-size: 0.9em;
          opacity: 0.8;
        }
        
        .comment-content {
          padding: 16px;
        }
        
        .issue-link {
          color: var(--vscode-textLink-foreground);
          text-decoration: none;
          padding: 6px 12px;
          border: 1px solid var(--vscode-button-border);
          border-radius: 4px;
          background: var(--vscode-button-secondaryBackground);
          transition: background-color 0.2s;
          font-size: 0.9em;
        }
        
        .issue-link:hover {
          background: var(--vscode-button-secondaryHoverBackground);
          text-decoration: none;
        }
    `;

    return `<!DOCTYPE html>
      <html lang="en">
      ${WebviewHelper.getHtmlHead(webview, extensionUri, `Issue ${issue.issueKey}`, additionalStyles, nonce)}
      <body>
        <div class="issue-header">
          <h1>${WebviewHelper.escapeHtml(issue.summary)}</h1>
          <div class="issue-meta">
            <span class="issue-key">${WebviewHelper.escapeHtml(issue.issueKey)}</span>
            <span class="status-badge ${this.getStatusClass(issue.status)}">${WebviewHelper.escapeHtml(issue.status.name)}</span>
            <span class="priority-badge ${this.getPriorityClass(issue.priority)}">${WebviewHelper.escapeHtml(issue.priority.name)}</span>
            ${baseUrl && issue.id ? `<a href="${issueUrl}" class="issue-link" target="_blank">Open in Backlog</a>` : ''}
          </div>
        </div>

        <div class="issue-details">
          <div class="issue-field">
            <label>Status:</label>
            <span>${WebviewHelper.escapeHtml(issue.status.name)}</span>
          </div>
          <div class="issue-field">
            <label>Priority:</label>
            <span>${WebviewHelper.escapeHtml(issue.priority.name)}</span>
          </div>
          ${issue.assignee ? `
            <div class="issue-field">
              <label>Assignee:</label>
              <span>${WebviewHelper.escapeHtml(issue.assignee.name)}</span>
            </div>
          ` : ''}
          ${issue.dueDate ? `
            <div class="issue-field">
              <label>Due Date:</label>
              <span>${new Date(issue.dueDate).toLocaleDateString()}</span>
            </div>
          ` : ''}
        </div>

        ${descriptionHtml ? `
          <div class="issue-description">
            <h3>Description</h3>
            <div class="issue-description-content markdown-content">
              ${descriptionHtml}
            </div>
          </div>
        ` : ''}

        ${commentsHtml.length > 0 ? `
          <div class="issue-comments">
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

        <script nonce="${nonce}">
          console.log('Issue webview loaded:', '${WebviewHelper.escapeHtml(issue.issueKey)}');
          
          // Handle external link clicks
          document.addEventListener('click', function(event) {
            const target = event.target;
            if (target && target.tagName === 'A' && target.href && target.target === '_blank') {
              event.preventDefault();
              const vscode = acquireVsCodeApi();
              vscode.postMessage({
                command: 'openExternal',
                url: target.href
              });
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
}
