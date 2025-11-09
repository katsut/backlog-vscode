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
