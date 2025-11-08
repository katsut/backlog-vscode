import * as vscode from 'vscode';
import { WebviewHelper } from './common';
import { MarkdownRenderer } from '../utils/markdownRenderer';
import { ConfigService } from '../services/configService';

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
    document: any, // Accept any document structure from tree or API
    configService: ConfigService
  ): string {
    const nonce = WebviewHelper.getNonce();
    const baseUrl = configService.getBaseUrl();
    const docUrl = baseUrl && document.id ? `${baseUrl}/file/${document.id}` : '#';

    // Get the display title, handling both tree nodes and document entities
    const displayTitle = document.title || document.name || 'Unnamed Document';

    // Check if document is a markdown file based on title
    const isMarkdownFile = this.isMarkdownDocument(document);
    
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
          border: 1px solid var(--vscode-panel-border);
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
        }
        
        .document-table td {
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
    `;

    return `<!DOCTYPE html>
      <html lang="en">
      ${WebviewHelper.getHtmlHead(webview, extensionUri, `Document: ${displayTitle}`, additionalStyles, nonce)}
      <body>
        <div class="document-header">
          <h1>
            ${WebviewHelper.escapeHtml(displayTitle)}
            ${isMarkdownFile ? '<span class="content-type-indicator">Markdown</span>' : ''}
          </h1>
          <div class="document-meta">
            ${document.created ? `<span class="meta-item">Created: ${new Date(document.created).toLocaleDateString()}</span>` : ''}
            ${document.createdUser ? `<span class="meta-item">Creator: ${WebviewHelper.escapeHtml(document.createdUser.name)}</span>` : ''}
            ${document.updated ? `<span class="meta-item">Updated: ${new Date(document.updated).toLocaleDateString()}</span>` : ''}
            ${document.updatedUser ? `<span class="meta-item">Updated by: ${WebviewHelper.escapeHtml(document.updatedUser.name)}</span>` : ''}
            ${baseUrl && document.id ? `<a href="${docUrl}" class="document-link" target="_blank">Open in Backlog</a>` : ''}
          </div>
        </div>

        <div class="document-content">
          ${isMarkdownFile ? `<div class="markdown-content">${contentHtml}</div>` : contentHtml}
        </div>

        <div class="document-info">
          <h3>Document Information</h3>
          <p><strong>Name:</strong> ${WebviewHelper.escapeHtml(displayTitle)}</p>
          ${document.created ? `<p><strong>Created:</strong> ${new Date(document.created).toLocaleDateString()} ${new Date(document.created).toLocaleTimeString()}</p>` : ''}
          ${document.createdUser ? `<p><strong>Creator:</strong> ${WebviewHelper.escapeHtml(document.createdUser.name)}</p>` : ''}
          ${document.updated ? `<p><strong>Last Updated:</strong> ${new Date(document.updated).toLocaleDateString()} ${new Date(document.updated).toLocaleTimeString()}</p>` : ''}
          ${document.updatedUser ? `<p><strong>Last Updated by:</strong> ${WebviewHelper.escapeHtml(document.updatedUser.name)}</p>` : ''}
        </div>

        <script nonce="${nonce}">
          // Add any client-side interactivity here if needed
          console.log('Document webview loaded:', '${WebviewHelper.escapeHtml(displayTitle)}');
          
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
   * Check if document is a markdown file
   */
  private static isMarkdownDocument(document: any): boolean {
    const title = document.title || document.name || '';
    if (!title) return false;
    
    const titleLower = title.toLowerCase();
    return titleLower.endsWith('.md') || 
           titleLower.endsWith('.markdown') || 
           titleLower.includes('readme');
  }

  /**
   * Convert document content to HTML
   */
  private static convertDocumentContent(document: any): string {
    // Check if document has JSON content (ProseMirror format)
    if (document.json && typeof document.json === 'object') {
      return this.convertProseMirrorToHtml(document.json);
    }
    
    // Check if document has plain text content
    if (document.content && typeof document.content === 'string') {
      return this.markdownRenderer.renderMarkdown(document.content);
    }
    
    // Fallback - no content available
    return '<p class="no-content">Document content preview is not available. Click the link above to view the full document in Backlog.</p>';
  }

  /**
   * Convert ProseMirror JSON to HTML
   */
  private static convertProseMirrorToHtml(json: any): string {
    if (!json || !json.content || !Array.isArray(json.content)) {
      return '<p class="no-content">No content available.</p>';
    }

    return `<div class="prosemirror-content">${json.content.map((node: any) => this.convertProseMirrorNode(node)).join('')}</div>`;
  }

  /**
   * Convert a single ProseMirror node to HTML
   */
  private static convertProseMirrorNode(node: any): string {
    if (!node) return '';

    switch (node.type) {
      case 'heading': {
        const level = node.attrs?.level || 1;
        const headingContent = this.convertNodeContent(node.content || []);
        return `<h${level}>${headingContent}</h${level}>`;
      }

      case 'paragraph': {
        const paragraphContent = this.convertNodeContent(node.content || []);
        return `<p>${paragraphContent}</p>`;
      }

      case 'bulletList': {
        const listItems = (node.content || []).map((item: any) => this.convertProseMirrorNode(item)).join('');
        return `<ul>${listItems}</ul>`;
      }

      case 'orderedList': {
        const orderedListItems = (node.content || []).map((item: any) => this.convertProseMirrorNode(item)).join('');
        return `<ol>${orderedListItems}</ol>`;
      }

      case 'listItem': {
        const itemContent = (node.content || []).map((item: any) => this.convertProseMirrorNode(item)).join('');
        return `<li>${itemContent}</li>`;
      }

      case 'table': {
        const tableContent = (node.content || []).map((row: any) => this.convertProseMirrorNode(row)).join('');
        return `<table class="document-table">${tableContent}</table>`;
      }

      case 'tableRow': {
        const rowContent = (node.content || []).map((cell: any) => this.convertProseMirrorNode(cell)).join('');
        return `<tr>${rowContent}</tr>`;
      }

      case 'tableCell':
      case 'tableHeader': {
        const cellContent = this.convertNodeContent(node.content || []);
        const tag = node.type === 'tableHeader' ? 'th' : 'td';
        return `<${tag}>${cellContent}</${tag}>`;
      }

      case 'blockquote': {
        const quoteContent = (node.content || []).map((item: any) => this.convertProseMirrorNode(item)).join('');
        return `<blockquote>${quoteContent}</blockquote>`;
      }

      case 'codeBlock': {
        const codeContent = this.extractTextFromContent(node.content || []);
        return `<pre><code>${WebviewHelper.escapeHtml(codeContent)}</code></pre>`;
      }

      case 'hardBreak':
        return '<br>';

      case 'text':
        return this.applyTextMarks(node.text || '', node.marks || []);

      default:
        // For unknown types, try to render content if available
        if (node.content && Array.isArray(node.content)) {
          return (node.content || []).map((item: any) => this.convertProseMirrorNode(item)).join('');
        }
        return '';
    }
  }

  /**
   * Convert node content array to HTML
   */
  private static convertNodeContent(content: any[]): string {
    return content.map(node => this.convertProseMirrorNode(node)).join('');
  }

  /**
   * Apply text marks (bold, italic, etc.) to text content
   */
  private static applyTextMarks(text: string, marks: any[]): string {
    let result = WebviewHelper.escapeHtml(text);
    
    for (const mark of marks) {
      switch (mark.type) {
        case 'bold':
          result = `<strong>${result}</strong>`;
          break;
        case 'italic':
          result = `<em>${result}</em>`;
          break;
        case 'code':
          result = `<code>${result}</code>`;
          break;
        case 'underline':
          result = `<u>${result}</u>`;
          break;
        case 'strike':
          result = `<del>${result}</del>`;
          break;
        case 'link': {
          const href = mark.attrs?.href || '#';
          result = `<a href="${WebviewHelper.escapeHtml(href)}" target="_blank">${result}</a>`;
          break;
        }
      }
    }
    
    return result;
  }

  /**
   * Extract plain text from content array
   */
  private static extractTextFromContent(content: any[]): string {
    return content.map(node => {
      if (node.type === 'text') {
        return node.text || '';
      }
      if (node.content && Array.isArray(node.content)) {
        return this.extractTextFromContent(node.content);
      }
      return '';
    }).join('');
  }

  /**
   * Heuristic to detect if content looks like markdown
   */
  private static looksLikeMarkdown(content: string): boolean {
    if (!content) return false;
    
    // Check for common markdown patterns
    const markdownPatterns = [
      /^#{1,6}\s/m,           // Headers
      /\*\*.*?\*\*/,          // Bold
      /\*.*?\*/,              // Italic
      /`.*?`/,                // Inline code
      /```[\s\S]*?```/,       // Code blocks
      /^\* /m,                // Unordered lists
      /^\d+\. /m,             // Ordered lists
      /^> /m,                 // Blockquotes
      /\[.*?\]\(.*?\)/,       // Links
      /!\[.*?\]\(.*?\)/       // Images
    ];

    return markdownPatterns.some(pattern => pattern.test(content));
  }
}
