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

    // Render comments as markdown
    const commentsHtml = comments && comments.length > 0
      ? comments.map(comment => ({
        ...comment,
        contentHtml: this.markdownRenderer.renderMarkdown(comment.content)
      }))
      : [];

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

        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          
          // Handle all clicks
          document.addEventListener('click', function(event) {
            const target = event.target;
            
            // Handle refresh button click
            if (target.closest('#refreshButton')) {
              event.preventDefault();
              event.stopPropagation();
              console.log('Refresh button clicked');
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
                console.log('Opening external URL via VS Code:', url);
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
}
