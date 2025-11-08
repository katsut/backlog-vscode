import * as vscode from 'vscode';
import { WebviewHelper } from './common';
import { MarkdownRenderer } from '../utils/markdownRenderer';
import { ConfigService } from '../services/configService';
import { Entity } from 'backlog-js';


/**
 * Document webview content generator
 */
export class DocumentWebview {
  private static markdownRenderer = MarkdownRenderer.getInstance();

  /**
   * Generate document webview content
   */
  static getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    document: Entity.Document.Document,
    configService: ConfigService,
    projectKey?: string
  ): string {
    const nonce = WebviewHelper.getNonce();
    const baseUrl = configService.getBaseUrl();
    const docUrl = baseUrl && document.id && projectKey ? `${baseUrl}/document/${projectKey}/${document.id}` : '#';

    // Get the display title, handling both tree nodes and document entities
    const displayTitle = document.title || 'Unnamed Document';

    // Convert document content if available
    const contentHtml = this.convertDocumentContent(document);

    const additionalStyles = `
        ${this.markdownRenderer.getMarkdownStyles()}
        
        .document-header {
          border-bottom: 2px solid var(--vscode-panel-border);
          padding-bottom: 16px;
          margin-bottom: 24px;
        }
        
        .document-header h1 {
          margin: 0 0 12px 0;
          color: var(--vscode-foreground);
          font-size: 1.8em;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .document-meta {
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
        
        .document-link {
          color: var(--vscode-textLink-foreground);
          text-decoration: none;
          padding: 6px 12px;
          border: 1px solid var(--vscode-button-border);
          border-radius: 4px;
          background: var(--vscode-button-secondaryBackground);
          transition: background-color 0.2s;
        }
        
        .document-link:hover {
          background: var(--vscode-button-secondaryHoverBackground);
          text-decoration: none;
        }
        
        .document-content {
          margin-top: 24px;
        }
        
        .content-type-indicator {
          display: inline-block;
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          padding: 2px 6px;
          border-radius: 12px;
          font-size: 0.8em;
          font-weight: 500;
          margin-left: 8px;
        }
        
        .plain-text-content {
          background: var(--vscode-textCodeBlock-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 6px;
          padding: 16px;
          white-space: pre-wrap;
          font-family: var(--vscode-editor-font-family);
          line-height: 1.6;
          overflow-x: auto;
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
        
        .document-info {
          background: var(--vscode-editor-inactiveSelectionBackground);
          border-left: 4px solid var(--vscode-textBlockQuote-border);
          padding: 16px;
          margin: 20px 0;
          border-radius: 0 6px 6px 0;
        }
        
        .document-info h3 {
          margin: 0 0 12px 0;
          color: var(--vscode-foreground);
          font-size: 1.1em;
        }
        
        .document-info p {
          margin: 8px 0;
          color: var(--vscode-foreground);
        }
        
        .document-info strong {
          color: var(--vscode-foreground);
        }
        
        /* ProseMirror content styles */
        .prosemirror-content {
          line-height: 1.6;
          color: var(--vscode-foreground);
        }
        
        .prosemirror-content h1,
        .prosemirror-content h2,
        .prosemirror-content h3,
        .prosemirror-content h4,
        .prosemirror-content h5,
        .prosemirror-content h6 {
          margin: 24px 0 16px 0;
          font-weight: 600;
          line-height: 1.25;
          color: var(--vscode-foreground);
        }
        
        .prosemirror-content h1 {
          border-bottom: 1px solid var(--vscode-panel-border);
          padding-bottom: 10px;
        }
        
        .prosemirror-content h2 {
          border-bottom: 1px solid var(--vscode-panel-border);
          padding-bottom: 8px;
        }
        
        .prosemirror-content p {
          margin: 16px 0;
        }
        
        .prosemirror-content ul,
        .prosemirror-content ol {
          margin: 16px 0;
          padding-left: 32px;
        }
        
        .prosemirror-content li {
          margin: 4px 0;
        }
        
        .prosemirror-content strong {
          font-weight: 600;
          color: var(--vscode-foreground);
        }
        
        .prosemirror-content em {
          font-style: italic;
        }
        
        .prosemirror-content code {
          background: var(--vscode-textCodeBlock-background);
          color: var(--vscode-textPreformat-foreground);
          padding: 2px 4px;
          border-radius: 3px;
          font-size: 0.9em;
          font-family: var(--vscode-editor-font-family);
        }
        
        .prosemirror-content pre {
          background: var(--vscode-textCodeBlock-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 6px;
          padding: 16px;
          overflow-x: auto;
          margin: 16px 0;
        }
        
        .prosemirror-content pre code {
          background: none;
          padding: 0;
          border-radius: 0;
          font-size: inherit;
        }
        
        .prosemirror-content blockquote {
          border-left: 4px solid var(--vscode-textBlockQuote-border);
          background: var(--vscode-textBlockQuote-background);
          padding: 16px;
          margin: 16px 0;
          font-style: italic;
        }
        
        .document-table {
          width: 100%;
          border-collapse: collapse;
          margin: 16px 0;
          background: var(--vscode-editor-background);
          border: 2px solid var(--vscode-panel-border);
        }
        
        .document-table th,
        .document-table td {
          border: 1px solid var(--vscode-panel-border);
          padding: 8px 12px;
          text-align: left;
          vertical-align: top;
        }
        
        .document-table th {
          background: var(--vscode-editor-inactiveSelectionBackground);
          font-weight: 600;
          color: var(--vscode-foreground);
          border-bottom: 2px solid var(--vscode-panel-border);
        }
        
        .document-table td {
          color: var(--vscode-foreground);
        }
        
        /* Ensure table borders are visible in all themes */
        .prosemirror-content table {
          width: 100%;
          border-collapse: collapse;
          margin: 16px 0;
          border: 2px solid var(--vscode-panel-border);
        }
        
        .prosemirror-content table th,
        .prosemirror-content table td {
          border: 1px solid var(--vscode-panel-border);
          padding: 8px 12px;
          text-align: left;
          vertical-align: top;
        }
        
        .prosemirror-content table th {
          background: var(--vscode-editor-inactiveSelectionBackground);
          font-weight: 600;
          color: var(--vscode-foreground);
          border-bottom: 2px solid var(--vscode-panel-border);
        }
        
        .prosemirror-content table td {
          color: var(--vscode-foreground);
        }
        
        .prosemirror-content a {
          color: var(--vscode-textLink-foreground);
          text-decoration: none;
        }
        
        .prosemirror-content a:hover {
          text-decoration: underline;
        }
        
        .prosemirror-content u {
          text-decoration: underline;
        }
        
        .prosemirror-content del {
          text-decoration: line-through;
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
      ${WebviewHelper.getHtmlHead(webview, extensionUri, `Document: ${displayTitle}`, additionalStyles, nonce)}
      <body>
        <div class="document-header">
          <h1>
            ${WebviewHelper.escapeHtml(displayTitle)}
            <button class="refresh-button" id="refreshButton" title="Refresh document content">
              <span class="codicon codicon-refresh"></span>
            </button>
          </h1>
          <div class="document-meta">
            ${document.created ? `<span class="meta-item">Created: ${new Date(document.created).toLocaleDateString()}</span>` : ''}
            ${document.createdUser ? `<span class="meta-item">Creator: ${WebviewHelper.escapeHtml(document.createdUser.name)}</span>` : ''}
            ${document.updated ? `<span class="meta-item">Updated: ${new Date(document.updated).toLocaleDateString()}</span>` : ''}
            ${document.updatedUser ? `<span class="meta-item">Updated by: ${WebviewHelper.escapeHtml(document.updatedUser.name)}</span>` : ''}
            ${baseUrl && document.id ? `<a href="${docUrl}" class="document-link" target="_blank">Open in Backlog</a>` : ''}
          </div>
        </div>


        <div class="document-info">
          <h3>Document Information</h3>
          <p><strong>Name:</strong> ${WebviewHelper.escapeHtml(displayTitle)}</p>
          ${document.created ? `<p><strong>Created:</strong> ${new Date(document.created).toLocaleDateString()} ${new Date(document.created).toLocaleTimeString()}</p>` : ''}
          ${document.createdUser ? `<p><strong>Creator:</strong> ${WebviewHelper.escapeHtml(document.createdUser.name)}</p>` : ''}
          ${document.updated ? `<p><strong>Last Updated:</strong> ${new Date(document.updated).toLocaleDateString()} ${new Date(document.updated).toLocaleTimeString()}</p>` : ''}
          ${document.updatedUser ? `<p><strong>Last Updated by:</strong> ${WebviewHelper.escapeHtml(document.updatedUser.name)}</p>` : ''}
        </div>

        <div class="document-content">
          <h3>Content</h3>
          <div class="prosemirror-content">
            ${contentHtml}
          </div>
        </div>

        <script nonce="${nonce}">
          // Add any client-side interactivity here if needed
          console.log('Document webview loaded:', '${WebviewHelper.escapeHtml(displayTitle)}');
          
          const vscode = acquireVsCodeApi();
          
          // Handle refresh button click
          document.addEventListener('DOMContentLoaded', function() {
            const refreshButton = document.getElementById('refreshButton');
            if (refreshButton) {
              refreshButton.addEventListener('click', function() {
                vscode.postMessage({
                  command: 'refreshDocument',
                  documentId: '${document.id || ''}'
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


  /**
   * Convert document content to HTML
   */
  private static convertDocumentContent(document: Entity.Document.Document): string {
    // Try different content fields in order of preference
    if (document.plain && document.plain.trim()) {
      return this.markdownRenderer.renderMarkdown(document.plain);
    }
    
    // Try JSON content if available and plain is not available
    if (document.json && typeof document.json === 'string' && document.json.trim()) {
      try {
        const jsonContent = JSON.parse(document.json);
        // If it's ProseMirror format, try to extract text content
        if (jsonContent.type === 'doc' && jsonContent.content) {
          const textContent = this.extractTextFromProseMirror(jsonContent);
          if (textContent.trim()) {
            return this.markdownRenderer.renderMarkdown(textContent);
          }
        }
      } catch (error) {
        console.log('Failed to parse JSON content:', error);
      }
    }
    

    // Fallback - no content available
    return '<p class="no-content">Document content preview is not available. Click the link above to view the full document in Backlog.</p>';
  }
  
  /**
   * Extract text content from ProseMirror JSON structure
   */
  private static extractTextFromProseMirror(node: any): string {
    if (!node) return '';
    
    let text = '';
    
    // If this node has text content
    if (node.text) {
      text += node.text;
    }
    
    // Process child nodes
    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        text += this.extractTextFromProseMirror(child);
        // Add line breaks for paragraph nodes
        if (child.type === 'paragraph') {
          text += '\n\n';
        }
      }
    }
    
    return text;
  }
}
