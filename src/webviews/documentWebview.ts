import * as vscode from 'vscode';
import { WebviewHelper } from './common';
import { MarkdownRenderer } from '../utils/markdownRenderer';
import { ConfigService } from '../services/configService';
import { BacklogApiService } from '../services/backlogApi';
import { Entity } from 'backlog-js';



/**
 * Document webview content generator
 */
export class DocumentWebview {
  private static markdownRenderer = MarkdownRenderer.getInstance();

  /**
   * Generate document webview content
   */
  static async getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    document: Entity.Document.Document,
    configService: ConfigService,
    backlogApi: BacklogApiService,
    projectKey?: string
  ): Promise<string> {
    const nonce = WebviewHelper.getNonce();
    const baseUrl = configService.getBaseUrl();
    const docUrl = baseUrl && document.id && projectKey ? `${baseUrl}/document/${projectKey}/${document.id}` : '#';

    // Get the display title, handling both tree nodes and document entities
    const displayTitle = document.title || 'Unnamed Document';

    // Convert document content if available
    const contentHtml = await this.convertDocumentContent(document, configService, backlogApi);

    const additionalStyles = `
        ${this.markdownRenderer.getMarkdownStyles()}
        
        /* Root container styling */
        body {
          font-family: var(--vscode-font-family);
          font-size: var(--vscode-font-size);
          line-height: 1.6;
          color: var(--vscode-foreground);
          background: var(--vscode-editor-background);
          margin: 0;
          padding: 20px;
          max-width: none;
        }
        
        /* Document header with improved typography */
        .document-header {
          border-bottom: 1px solid var(--vscode-panel-border);
          padding-bottom: 20px;
          margin-bottom: 32px;
          background: var(--vscode-editor-background);
        }
        
        .document-header h1 {
          margin: 0 0 16px 0;
          color: var(--vscode-foreground);
          font-size: 1.75rem;
          font-weight: 600;
          line-height: 1.3;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        
        .document-meta {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          color: var(--vscode-descriptionForeground);
          font-size: 0.875rem;
          align-items: center;
          margin-top: 8px;
        }
        
        .meta-item {
          background: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 0.8rem;
          font-weight: 500;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        
        .document-link {
          color: var(--vscode-textLink-foreground);
          text-decoration: none;
          padding: 8px 16px;
          border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
          border-radius: 6px;
          background: var(--vscode-button-secondaryBackground);
          transition: all 0.2s ease;
          font-size: 0.875rem;
          font-weight: 500;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        
        .document-link:hover {
          background: var(--vscode-button-secondaryHoverBackground);
          text-decoration: none;
          transform: translateY(-1px);
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .document-link::before {
          content: "🔗";
          font-size: 14px;
        }
        
        /* Document content section */
        .document-content {
          margin-top: 32px;
        }
        
        .document-content h3 {
          color: var(--vscode-foreground);
          font-size: 1.25rem;
          font-weight: 600;
          margin: 0 0 16px 0;
          padding-bottom: 8px;
          border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .content-type-indicator {
          display: inline-block;
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 0.75rem;
          font-weight: 500;
          margin-left: 8px;
        }
        
        .plain-text-content {
          background: var(--vscode-textCodeBlock-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 8px;
          padding: 20px;
          white-space: pre-wrap;
          font-family: var(--vscode-editor-font-family);
          line-height: 1.7;
          overflow-x: auto;
          font-size: 0.9rem;
        }
        
        .no-content {
          color: var(--vscode-descriptionForeground);
          font-style: italic;
          text-align: center;
          padding: 40px 24px;
          background: var(--vscode-editor-inactiveSelectionBackground);
          border-radius: 8px;
          border: 2px dashed var(--vscode-panel-border);
          font-size: 0.95rem;
        }
        
        /* Document info card with better styling */
        .document-info {
          background: var(--vscode-editor-inactiveSelectionBackground);
          border-left: 4px solid var(--vscode-textBlockQuote-border);
          padding: 20px;
          margin: 24px 0;
          border-radius: 0 8px 8px 0;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .document-info h3 {
          margin: 0 0 16px 0;
          color: var(--vscode-foreground);
          font-size: 1.1rem;
          font-weight: 600;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .document-info h3::before {
          content: "ℹ️";
          font-size: 16px;
          color: var(--vscode-textBlockQuote-border);
        }
        
        .document-info p {
          margin: 10px 0;
          color: var(--vscode-foreground);
          line-height: 1.5;
          font-size: 0.9rem;
        }
        
        .document-info strong {
          color: var(--vscode-foreground);
          font-weight: 600;
        }
        
        /* Enhanced ProseMirror content styles matching markdown styling */
        .prosemirror-content {
          line-height: 1.7;
          color: var(--vscode-foreground);
          font-size: 0.95rem;
        }
        
        /* Typography hierarchy consistent with markdown */
        .prosemirror-content h1,
        .prosemirror-content h2,
        .prosemirror-content h3,
        .prosemirror-content h4,
        .prosemirror-content h5,
        .prosemirror-content h6 {
          color: var(--vscode-foreground);
          margin-top: 32px;
          margin-bottom: 20px;
          font-weight: 600;
          line-height: 1.3;
        }
        
        .prosemirror-content h1 {
          font-size: 1.75rem;
          border-bottom: 2px solid var(--vscode-panel-border);
          padding-bottom: 12px;
          margin-top: 0;
        }
        
        .prosemirror-content h2 {
          font-size: 1.5rem;
          border-bottom: 1px solid var(--vscode-panel-border);
          padding-bottom: 10px;
        }
        
        .prosemirror-content h3 {
          font-size: 1.25rem;
        }
        
        .prosemirror-content h4 {
          font-size: 1.1rem;
        }
        
        .prosemirror-content h5 {
          font-size: 1rem;
        }
        
        .prosemirror-content h6 {
          font-size: 0.95rem;
          color: var(--vscode-descriptionForeground);
        }
        
        /* Better paragraph and list spacing */
        .prosemirror-content p {
          margin-bottom: 20px;
          line-height: 1.7;
        }
        
        .prosemirror-content ul,
        .prosemirror-content ol {
          margin-bottom: 20px;
          padding-left: 28px;
        }
        
        .prosemirror-content li {
          margin-bottom: 6px;
          line-height: 1.6;
        }
        
        .prosemirror-content ul li {
          list-style-type: disc;
        }
        
        .prosemirror-content ul ul li {
          list-style-type: circle;
        }
        
        .prosemirror-content ul ul ul li {
          list-style-type: square;
        }
        
        /* Enhanced text formatting */
        .prosemirror-content strong {
          font-weight: 600;
          color: var(--vscode-foreground);
        }
        
        .prosemirror-content em {
          font-style: italic;
        }
        
        .prosemirror-content u {
          text-decoration: underline;
        }
        
        .prosemirror-content del {
          text-decoration: line-through;
        }
        
        /* Enhanced code styling */
        .prosemirror-content code {
          background: var(--vscode-textCodeBlock-background);
          color: var(--vscode-textPreformat-foreground);
          padding: 3px 6px;
          border-radius: 4px;
          font-family: var(--vscode-editor-font-family);
          font-size: 0.9em;
          border: 1px solid var(--vscode-panel-border);
        }
        
        .prosemirror-content pre {
          background: var(--vscode-textCodeBlock-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: 8px;
          padding: 20px;
          overflow-x: auto;
          margin: 24px 0;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .prosemirror-content pre code {
          background: none;
          padding: 0;
          border: none;
          font-size: 0.9rem;
          line-height: 1.5;
        }
        
        /* Enhanced blockquote styling */
        .prosemirror-content blockquote {
          margin: 24px 0;
          padding: 16px 20px;
          color: var(--vscode-descriptionForeground);
          border-left: 4px solid var(--vscode-textBlockQuote-border);
          background: var(--vscode-textBlockQuote-background);
          border-radius: 0 6px 6px 0;
          font-style: italic;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        /* Enhanced table styling unified */
        .prosemirror-content table,
        .document-table {
          width: 100%;
          border-collapse: collapse;
          margin: 24px 0;
          border: 2px solid var(--vscode-panel-border);
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .prosemirror-content table th,
        .prosemirror-content table td,
        .document-table th,
        .document-table td {
          border: 1px solid var(--vscode-panel-border);
          padding: 12px 16px;
          text-align: left;
          vertical-align: top;
        }
        
        .prosemirror-content table th,
        .document-table th {
          background: var(--vscode-editor-inactiveSelectionBackground);
          font-weight: 600;
          color: var(--vscode-foreground);
          border-bottom: 2px solid var(--vscode-panel-border);
        }
        
        .prosemirror-content table td,
        .document-table td {
          color: var(--vscode-foreground);
        }
        
        .prosemirror-content table tr:nth-child(even),
        .document-table tr:nth-child(even) {
          background: var(--vscode-editor-inactiveSelectionBackground);
        }
        
        .prosemirror-content table tr:hover,
        .document-table tr:hover {
          background: var(--vscode-list-hoverBackground);
        }
        
        /* Enhanced link styling */
        .prosemirror-content a {
          color: var(--vscode-textLink-foreground);
          text-decoration: none;
          border-bottom: 1px solid transparent;
          transition: all 0.2s ease;
        }
        
        .prosemirror-content a:hover {
          color: var(--vscode-textLink-activeForeground);
          border-bottom-color: var(--vscode-textLink-activeForeground);
        }
        
        /* Horizontal rule styling */
        .prosemirror-content hr {
          border: none;
          height: 2px;
          background: linear-gradient(to right, transparent, var(--vscode-panel-border), transparent);
          margin: 32px 0;
        }
        
        /* Improved refresh button with VS Code styling */
        .refresh-button {
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
          border-radius: 6px;
          padding: 8px 12px;
          margin-left: 16px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s ease;
          min-width: 36px;
          min-height: 36px;
          font-size: 0.875rem;
          font-weight: 500;
          gap: 6px;
        }
        
        .refresh-button:hover {
          background: var(--vscode-button-secondaryHoverBackground);
          border-color: var(--vscode-button-border);
          transform: translateY(-1px);
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        
        .refresh-button:active {
          background: var(--vscode-button-secondaryHoverBackground);
          transform: translateY(0);
          box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }
        
        .refresh-button .codicon {
          font-size: 14px;
          color: var(--vscode-button-secondaryForeground);
        }
        
        .refresh-button::before {
          content: "🔄";
          font-size: 14px;
        }
        
        /* Embedded image styles */
        .embedded-image {
          max-width: 100%;
          height: auto;
          border-radius: 4px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        
        /* Error message styles */
        .attachment-error {
          padding: 16px;
          border: 1px dashed var(--vscode-panel-border);
          border-radius: 4px;
          color: var(--vscode-descriptionForeground);
          text-align: center;
          font-style: italic;
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
  private static async convertDocumentContent(
    document: Entity.Document.Document,
    configService: ConfigService,
    backlogApi: BacklogApiService
  ): Promise<string> {
    // Download all attachments and convert to data URLs
    const processedAttachments: Array<{ id: number; name: string; dataUrl: string }> = [];
    
    if (document.attachments && document.attachments.length > 0) {
      for (const attachment of document.attachments) {
        try {
          const buffer = await backlogApi.downloadDocumentAttachment(document.id, attachment.id);
          const mimeType = this.getMimeTypeFromFileName(attachment.name);
          const base64Data = buffer.toString('base64');
          const dataUrl = `data:${mimeType};base64,${base64Data}`;
          
          processedAttachments.push({
            id: attachment.id,
            name: attachment.name,
            dataUrl: dataUrl
          });
        } catch (error) {
          console.error(`Failed to download attachment ${attachment.id} (${attachment.name}):`, error);
          // Continue with other attachments even if one fails
        }
      }
    }

    if (document.plain && document.plain.trim()) {
      return this.markdownRenderer.renderMarkdown(document.plain, processedAttachments);
    }

    // Fallback - no content available
    return '<p class="no-content">Document content preview is not available. Click the link above to view the full document in Backlog.</p>';
  }

  /**
   * Convert ProseMirror JSON to HTML
   */
  private static async convertProseMirrorToHtml(
    node: Record<string, any>,
    configService: ConfigService,
    backlogApi: BacklogApiService,
    document: Entity.Document.Document
  ): Promise<string> {
    if (!node) {
      return '';
    }

    // Handle text nodes
    if (node.text) {
      let text = WebviewHelper.escapeHtml(node.text);

      // Apply text marks (bold, italic, links, etc.)
      if (node.marks && Array.isArray(node.marks)) {
        for (const mark of node.marks) {
          switch (mark.type) {
            case 'strong':
              text = `<strong>${text}</strong>`;
              break;
            case 'em':
              text = `<em>${text}</em>`;
              break;
            case 'code':
              text = `<code>${text}</code>`;
              break;
            case 'underline':
              text = `<u>${text}</u>`;
              break;
            case 'strike':
              text = `<del>${text}</del>`;
              break;
            case 'link':
              const href = mark.attrs?.href || '#';
              text = `<a href="${WebviewHelper.escapeHtml(href)}" target="_blank">${text}</a>`;
              break;
          }
        }
      }

      return text;
    }

    // Handle different node types
    let html = '';

    switch (node.type) {
      case 'doc':
        // Root document node - process content
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            html += await this.convertProseMirrorToHtml(child, configService, backlogApi, document);
          }
        }
        break;

      case 'paragraph':
        html += '<p>';
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            html += await this.convertProseMirrorToHtml(child, configService, backlogApi, document);
          }
        }
        html += '</p>';
        break;

      case 'heading': {
        const level = node.attrs?.level || 1;
        const headingTag = `h${Math.min(Math.max(level, 1), 6)}`;
        html += `<${headingTag}>`;
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            html += await this.convertProseMirrorToHtml(child, configService, backlogApi, document);
          }
        }
        html += `</${headingTag}>`;
        break;
      }

      case 'bulletList':
        html += '<ul>';
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            html += await this.convertProseMirrorToHtml(child, configService, backlogApi, document);
          }
        }
        html += '</ul>';
        break;

      case 'orderedList': {
        const start = node.attrs?.start || 1;
        html += `<ol${start !== 1 ? ` start="${start}"` : ''}>`;
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            html += await this.convertProseMirrorToHtml(child, configService, backlogApi, document);
          }
        }
        html += '</ol>';
        break;
      }

      case 'listItem':
        html += '<li>';
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            html += await this.convertProseMirrorToHtml(child, configService, backlogApi, document);
          }
        }
        html += '</li>';
        break;

      case 'blockquote':
        html += '<blockquote>';
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            html += await this.convertProseMirrorToHtml(child, configService, backlogApi, document);
          }
        }
        html += '</blockquote>';
        break;

      case 'codeBlock': {
        const language = node.attrs?.language || '';
        html += '<pre>';
        if (language) {
          html += `<code class="language-${WebviewHelper.escapeHtml(language)}">`;
        } else {
          html += '<code>';
        }
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            html += await this.convertProseMirrorToHtml(child, configService, backlogApi, document);
          }
        }
        html += '</code></pre>';
        break;
      }

      case 'table':
        html += '<table class="document-table">';
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            html += await this.convertProseMirrorToHtml(child, configService, backlogApi, document);
          }
        }
        html += '</table>';
        break;

      case 'tableRow':
        html += '<tr>';
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            html += await this.convertProseMirrorToHtml(child, configService, backlogApi, document);
          }
        }
        html += '</tr>';
        break;

      case 'tableCell':
      case 'tableHeader': {
        const tag = node.type === 'tableHeader' ? 'th' : 'td';
        const colspan = node.attrs?.colspan || 1;
        const rowspan = node.attrs?.rowspan || 1;
        const colspanAttr = colspan > 1 ? ` colspan="${colspan}"` : '';
        const rowspanAttr = rowspan > 1 ? ` rowspan="${rowspan}"` : '';

        html += `<${tag}${colspanAttr}${rowspanAttr}>`;
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            html += await this.convertProseMirrorToHtml(child, configService, backlogApi, document);
          }
        }
        html += `</${tag}>`;
        break;
      }

      case 'hardBreak':
        html += '<br>';
        break;

      case 'horizontalRule':
        html += '<hr>';
        break;

      case 'image': {
        // Handle embedded images
        const src = node.attrs?.src || '';
        const alt = node.attrs?.alt || '';
        const title = node.attrs?.title || '';

        if (src) {
          // Check if it's a Backlog attachment reference
          if (src.startsWith('/api/v2/attachments/')) {
            try {
              // Extract attachment ID from URL
              const attachmentIdStr = src.split('/').pop();
              const attachmentId = attachmentIdStr ? parseInt(attachmentIdStr, 10) : null;

              if (attachmentId && !isNaN(attachmentId) && document.id) {
                // Find the attachment info in document.attachments
                const attachment = document.attachments?.find(att => att.id === attachmentId);

                if (attachment) {
                  // Download and embed the attachment as base64 data URL
                  const base64Image = await this.downloadAndEncodeAttachment(
                    document.id,
                    attachmentId,
                    attachment.name,
                    backlogApi
                  );

                  if (base64Image) {
                    html += `<img src="${base64Image}" alt="${WebviewHelper.escapeHtml(alt)}" title="${WebviewHelper.escapeHtml(title)}" class="embedded-image">`;
                  } else {
                    html += `<div class="attachment-error">Failed to load image attachment: ${WebviewHelper.escapeHtml(attachment.name)}</div>`;
                  }
                } else {
                  html += `<div class="attachment-error">Image attachment not found in document attachments</div>`;
                }
              } else {
                html += `<div class="attachment-error">Invalid attachment ID in image source</div>`;
              }
            } catch (error) {
              console.log('Failed to load attachment:', error);
              html += `<div class="attachment-error">Failed to load image attachment</div>`;
            }
          } else {
            // Regular image URL
            html += `<img src="${WebviewHelper.escapeHtml(src)}" alt="${WebviewHelper.escapeHtml(alt)}" title="${WebviewHelper.escapeHtml(title)}" class="embedded-image">`;
          }
        }
        break;
      }

      default:
        // For unknown node types, process content if available
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            html += await this.convertProseMirrorToHtml(child, configService, backlogApi, document);
          }
        }
        break;
    }

    return html;
  }

  /**
   * Download attachment and encode as base64 data URL
   */
  private static async downloadAndEncodeAttachment(
    documentId: string,
    attachmentId: number,
    fileName: string,
    backlogApi: BacklogApiService
  ): Promise<string | null> {
    try {
      // Download the attachment
      const buffer = await backlogApi.downloadDocumentAttachment(documentId, attachmentId);

      // Determine MIME type from file extension
      const mimeType = this.getMimeTypeFromFileName(fileName);

      // Convert Buffer to base64
      const base64Data = buffer.toString('base64');

      // Return as data URL
      return `data:${mimeType};base64,${base64Data}`;
    } catch (error) {
      console.error('Failed to download and encode attachment:', error);
      return null;
    }
  }

  /**
   * Get MIME type from file name extension
   */
  private static getMimeTypeFromFileName(fileName: string): string {
    const extension = fileName.toLowerCase().split('.').pop() || '';

    const mimeTypes: Record<string, string> = {
      // Images
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'bmp': 'image/bmp',
      'webp': 'image/webp',
      'svg': 'image/svg+xml',
      'ico': 'image/x-icon',
      'tiff': 'image/tiff',
      'tif': 'image/tiff',

      // Documents
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

      // Text
      'txt': 'text/plain',
      'html': 'text/html',
      'htm': 'text/html',
      'css': 'text/css',
      'js': 'text/javascript',
      'json': 'application/json',
      'xml': 'text/xml',

      // Archives
      'zip': 'application/zip',
      'rar': 'application/x-rar-compressed',
      '7z': 'application/x-7z-compressed',
      'tar': 'application/x-tar',
      'gz': 'application/gzip',

      // Default
      '': 'application/octet-stream'
    };

    return mimeTypes[extension] || 'application/octet-stream';
  }

  /**
   * Extract text content from ProseMirror JSON structure
   */
  private static extractTextFromProseMirror(node: Record<string, unknown>): string {
    if (!node) {
      return '';
    }

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
