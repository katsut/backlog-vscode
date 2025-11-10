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
    
    // Ensure baseUrl has https:// protocol
    const fullBaseUrl = baseUrl ? (baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`) : null;
    const wikiUrl = fullBaseUrl && wiki.id ? `${fullBaseUrl}/alias/wiki/${wiki.id}` : '#';

    // Render wiki content as markdown
    const contentHtml = wiki.content 
      ? this.markdownRenderer.renderMarkdown(wiki.content)
      : '';

    const additionalStyles = `
        /* Wiki-specific styles - most styling now comes from common CSS */
    `;

    return `<!DOCTYPE html>
      <html lang="en">
      ${WebviewHelper.getHtmlHead(webview, extensionUri, `Wiki: ${wiki.name}`, additionalStyles, nonce)}
      <body>
        <div class="webview-header">
          <h1>
            ${WebviewHelper.escapeHtml(wiki.name)}
            <button class="refresh-button" id="refreshButton" title="Refresh wiki content">
              <span class="codicon codicon-refresh"></span>
            </button>
          </h1>
          <div class="webview-meta">
            ${wiki.createdUser ? `<span class="meta-item">Created by: ${WebviewHelper.escapeHtml(wiki.createdUser.name)}</span>` : ''}
            ${wiki.created ? `<span class="meta-item">Created: ${new Date(wiki.created).toLocaleDateString()}</span>` : ''}
            ${wiki.updatedUser ? `<span class="meta-item">Updated by: ${WebviewHelper.escapeHtml(wiki.updatedUser.name)}</span>` : ''}
            ${wiki.updated ? `<span class="meta-item">Updated: ${new Date(wiki.updated).toLocaleDateString()}</span>` : ''}
            ${fullBaseUrl && wiki.id ? `<a href="#" class="external-link" data-url="${wikiUrl}">🔗 Open in Backlog</a>` : ''}
            ${wiki.tags && wiki.tags.length > 0 ? `
              <div class="tags-container">
                <span class="tags-label">Tags:</span>
                ${wiki.tags.map(tag => `<span class="tag-badge">${WebviewHelper.escapeHtml(tag.name)}</span>`).join('')}
              </div>
            ` : ''}
          </div>
        </div>

        ${wiki.attachments && wiki.attachments.length > 0 ? `
          <div class="section">
            <h3>Attachments (${wiki.attachments.length})</h3>
            <div class="attachments-list">
              ${wiki.attachments.map(attachment => `
                <div class="list-item">
                  <span class="list-item-name">${WebviewHelper.escapeHtml(attachment.name)}</span>
                  <span class="list-item-meta">${WebviewHelper.formatFileSize(attachment.size)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
        
        ${wiki.sharedFiles && wiki.sharedFiles.length > 0 ? `
          <div class="section">
            <h3>Shared Files (${wiki.sharedFiles.length})</h3>
            <div class="shared-files-list">
              ${wiki.sharedFiles.map(file => `
                <div class="list-item">
                  <span class="list-item-name">${WebviewHelper.escapeHtml(file.name)}</span>
                  <span class="list-item-meta">${WebviewHelper.formatFileSize(file.size)}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${wiki.stars && wiki.stars.length > 0 ? `
          <div class="section">
            <h3>Stars: ${wiki.stars.length}</h3>
          </div>
        ` : ''}

        <div class="content-section">
          <h3>Content</h3>
          ${contentHtml ? `
            <div class="content-body markdown-content">
              ${contentHtml}
            </div>
          ` : '<p class="no-content">No content available for this wiki page.</p>'}
        </div>

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
                command: 'refreshWiki',
                wikiId: '${wiki.id || ''}'
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
}
