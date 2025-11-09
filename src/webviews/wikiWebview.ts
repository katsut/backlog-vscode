import * as vscode from 'vscode';
import { Entity } from 'backlog-js';
import { WebviewHelper } from './common';
import { MarkdownRenderer } from '../utils/markdownRenderer';

/**
 * Wiki webview content generator
 */
export class WikiWebview {
  private static markdownRenderer = MarkdownRenderer.getInstance();

  /**
   * Generate wiki webview content
   */
  static getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    wiki: Entity.Wiki.Wiki,
    baseUrl?: string
  ): string {
    const nonce = WebviewHelper.getNonce();
    const wikiUrl = baseUrl && wiki.id ? `${baseUrl}/alias/wiki/${wiki.id}` : '#';

    // Render wiki content as markdown
    const contentHtml = wiki.content 
      ? this.markdownRenderer.renderMarkdown(wiki.content)
      : '';

    const additionalStyles = `
        ${this.markdownRenderer.getMarkdownStyles()}
        
        .wiki-header {
          border-bottom: 2px solid var(--vscode-panel-border);
          padding-bottom: 16px;
          margin-bottom: 24px;
        }
        
        .wiki-header h1 {
          margin: 0 0 12px 0;
          color: var(--vscode-foreground);
          font-size: 1.8em;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .wiki-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
          color: var(--vscode-descriptionForeground);
          font-size: 0.9em;
          align-items: center;
        }
        
        .meta-item {
          background: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.85em;
        }
        
        .wiki-tags {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          margin-top: 8px;
          width: 100%;
        }
        
        .meta-label {
          color: var(--vscode-foreground);
          font-weight: 500;
        }
        
        .tag-badge {
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          padding: 2px 6px;
          border-radius: 12px;
          font-size: 0.8em;
          border: 1px solid var(--vscode-button-border);
        }
        
        .wiki-section {
          margin: 20px 0;
          padding: 16px;
          background: var(--vscode-editor-inactiveSelectionBackground);
          border-radius: 6px;
          border-left: 4px solid var(--vscode-textBlockQuote-border);
        }
        
        .wiki-section h3 {
          margin: 0 0 12px 0;
          color: var(--vscode-foreground);
          font-size: 1.1em;
        }
        
        .attachment-item, .shared-file-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
          border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .attachment-item:last-child, .shared-file-item:last-child {
          border-bottom: none;
        }
        
        .attachment-name, .file-name {
          font-weight: 500;
          color: var(--vscode-foreground);
        }
        
        .attachment-size, .file-size {
          color: var(--vscode-descriptionForeground);
          font-size: 0.9em;
        }
        
        .wiki-content {
          margin-top: 32px;
        }
        
        .wiki-content h3 {
          color: var(--vscode-foreground);
          margin-bottom: 16px;
          font-size: 1.2em;
        }
        
        .wiki-content-body {
          background: var(--vscode-textCodeBlock-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 6px;
          padding: 16px;
        }
        
        .no-content {
          color: var(--vscode-descriptionForeground);
          font-style: italic;
          text-align: center;
          padding: 32px 20px;
          background: var(--vscode-editor-inactiveSelectionBackground);
          border-radius: 6px;
          border: 1px dashed var(--vscode-panel-border);
        }
        
        .wiki-link {
          color: var(--vscode-textLink-foreground);
          text-decoration: none;
          padding: 6px 12px;
          border: 1px solid var(--vscode-button-border);
          border-radius: 4px;
          background: var(--vscode-button-secondaryBackground);
          transition: background-color 0.2s;
          font-size: 0.9em;
        }
        
        .wiki-link:hover {
          background: var(--vscode-button-secondaryHoverBackground);
          text-decoration: none;
        }
        
        /* Refresh button styles */
        .refresh-button {
          background: var(--vscode-button-background, #0078d4);
          color: var(--vscode-button-foreground, #ffffff);
          border: 1px solid var(--vscode-button-border, transparent);
          border-radius: 4px;
          padding: 6px 8px;
          margin-left: 12px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
          min-width: 32px;
          min-height: 32px;
        }
        
        .refresh-button:hover {
          background: var(--vscode-button-hoverBackground, #005a9e);
          transform: scale(1.05);
        }
        
        .refresh-button:active {
          background: var(--vscode-button-activeBackground, #004578);
          transform: scale(0.95);
        }
        
        .refresh-button .codicon {
          font-size: 16px;
          color: var(--vscode-button-foreground, #ffffff);
          font-weight: bold;
        }
    `;

    return `<!DOCTYPE html>
      <html lang="en">
      ${WebviewHelper.getHtmlHead(webview, extensionUri, `Wiki: ${wiki.name}`, additionalStyles, nonce)}
      <body>
        <div class="wiki-header">
          <h1>
            ${WebviewHelper.escapeHtml(wiki.name)}
            <button class="refresh-button" id="refreshButton" title="Refresh wiki content">
              <span class="codicon codicon-refresh"></span>
            </button>
          </h1>
          <div class="wiki-meta">
            ${wiki.createdUser ? `<span class="meta-item">Created by: ${WebviewHelper.escapeHtml(wiki.createdUser.name)}</span>` : ''}
            ${wiki.created ? `<span class="meta-item">Created: ${new Date(wiki.created).toLocaleDateString()}</span>` : ''}
            ${wiki.updatedUser ? `<span class="meta-item">Updated by: ${WebviewHelper.escapeHtml(wiki.updatedUser.name)}</span>` : ''}
            ${wiki.updated ? `<span class="meta-item">Updated: ${new Date(wiki.updated).toLocaleDateString()}</span>` : ''}
            ${baseUrl && wiki.id ? `<a href="${wikiUrl}" class="wiki-link" target="_blank">Open in Backlog</a>` : ''}
            ${wiki.tags && wiki.tags.length > 0 ? `
              <div class="wiki-tags">
                <span class="meta-label">Tags:</span>
                ${wiki.tags.map(tag => `<span class="tag-badge">${WebviewHelper.escapeHtml(tag.name)}</span>`).join('')}
              </div>
            ` : ''}
          </div>
        </div>

        <div class="wiki-details">
          ${wiki.attachments && wiki.attachments.length > 0 ? `
            <div class="wiki-section">
              <h3>Attachments (${wiki.attachments.length})</h3>
              <div class="attachments-list">
                ${wiki.attachments.map(attachment => `
                  <div class="attachment-item">
                    <span class="attachment-name">${WebviewHelper.escapeHtml(attachment.name)}</span>
                    <span class="attachment-size">${WebviewHelper.formatFileSize(attachment.size)}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
          
          ${wiki.sharedFiles && wiki.sharedFiles.length > 0 ? `
            <div class="wiki-section">
              <h3>Shared Files (${wiki.sharedFiles.length})</h3>
              <div class="shared-files-list">
                ${wiki.sharedFiles.map(file => `
                  <div class="shared-file-item">
                    <span class="file-name">${WebviewHelper.escapeHtml(file.name)}</span>
                    <span class="file-size">${WebviewHelper.formatFileSize(file.size)}</span>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          ${wiki.stars && wiki.stars.length > 0 ? `
            <div class="wiki-section">
              <h3>Stars: ${wiki.stars.length}</h3>
            </div>
          ` : ''}
        </div>

        <div class="wiki-content">
          <h3>Content</h3>
          ${contentHtml ? `
            <div class="wiki-content-body markdown-content">
              ${contentHtml}
            </div>
          ` : '<p class="no-content">No content available for this wiki page.</p>'}
        </div>

        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();
          
          // Handle refresh button click
          document.addEventListener('DOMContentLoaded', function() {
            const refreshButton = document.getElementById('refreshButton');
            if (refreshButton) {
              refreshButton.addEventListener('click', function() {
                vscode.postMessage({
                  command: 'refreshWiki',
                  wikiId: '${wiki.id || ''}'
                });
              });
            }
          });
          
          // Handle external link clicks
          document.addEventListener('click', function(event) {
            const target = event.target;
            if (target && target.tagName === 'A' && target.href && target.target === '_blank') {
              event.preventDefault();
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
}
