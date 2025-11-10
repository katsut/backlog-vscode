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

    // Ensure baseUrl has https:// protocol
    const fullBaseUrl = baseUrl ? (baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`) : null;
    const docUrl = fullBaseUrl && document.id && projectKey ? `${fullBaseUrl}/document/${projectKey}/${document.id}` : '#';

    // Get the display title, handling both tree nodes and document entities
    const displayTitle = document.title || 'Unnamed Document';

    // Convert document content if available
    const contentHtml = await this.convertDocumentContent(document, configService, backlogApi);

    const additionalStyles = `
        /* Document-specific styles */
        .plain-text-content {
          background: var(--vscode-textCodeBlock-background);
          border: 1px solid var(--vscode-panel-border);
          border-radius: var(--webview-radius-lg);
          padding: var(--webview-space-xl);
          white-space: pre-wrap;
          font-family: var(--webview-mono-font-family);
          line-height: 1.7;
          overflow-x: auto;
          font-size: var(--webview-font-size-sm);
        }
        
        .content-type-indicator {
          display: inline-block;
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          padding: 3px var(--webview-space-sm);
          border-radius: var(--webview-radius-xl);
          font-size: var(--webview-font-size-xs);
          font-weight: 500;
          margin-left: var(--webview-space-sm);
        }
    `;

    return `<!DOCTYPE html>
      <html lang="en">
      ${WebviewHelper.getHtmlHead(webview, extensionUri, `Document: ${displayTitle}`, additionalStyles, nonce)}
      <body>
        <div class="webview-header">
          <h1>
            ${WebviewHelper.escapeHtml(displayTitle)}
            <button class="refresh-button" id="refreshButton" title="Refresh document content">
              <span class="codicon codicon-refresh"></span>
            </button>
          </h1>
          <div class="webview-meta">
            ${document.created ? `<span class="meta-item">Created: ${new Date(document.created).toLocaleDateString()}</span>` : ''}
            ${document.createdUser ? `<span class="meta-item">Creator: ${WebviewHelper.escapeHtml(document.createdUser.name)}</span>` : ''}
            ${document.updated ? `<span class="meta-item">Updated: ${new Date(document.updated).toLocaleDateString()}</span>` : ''}
            ${document.updatedUser ? `<span class="meta-item">Updated by: ${WebviewHelper.escapeHtml(document.updatedUser.name)}</span>` : ''}
            ${fullBaseUrl && document.id ? `<a href="#" class="external-link" data-url="${docUrl}">🔗 Open in Backlog</a>` : ''}
          </div>
        </div>

        <div class="info-card">
          <h3>Document Information</h3>
          <p><strong>Name:</strong> ${WebviewHelper.escapeHtml(displayTitle)}</p>
          ${document.created ? `<p><strong>Created:</strong> ${new Date(document.created).toLocaleDateString()} ${new Date(document.created).toLocaleTimeString()}</p>` : ''}
          ${document.createdUser ? `<p><strong>Creator:</strong> ${WebviewHelper.escapeHtml(document.createdUser.name)}</p>` : ''}
          ${document.updated ? `<p><strong>Last Updated:</strong> ${new Date(document.updated).toLocaleDateString()} ${new Date(document.updated).toLocaleTimeString()}</p>` : ''}
          ${document.updatedUser ? `<p><strong>Last Updated by:</strong> ${WebviewHelper.escapeHtml(document.updatedUser.name)}</p>` : ''}
        </div>

        <div class="content-section">
          <h3>Content</h3>
          <div class="content-body markdown-content">
            ${contentHtml}
          </div>
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
              vscode.postMessage({
                command: 'refreshDocument',
                documentId: '${document.id || ''}'
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
    node: Record<string, unknown>,
    configService: ConfigService,
    backlogApi: BacklogApiService,
    document: Entity.Document.Document
  ): Promise<string> {
    if (!node) {
      return '';
    }

    // Handle text nodes
    if (typeof node.text === 'string') {
      let text = WebviewHelper.escapeHtml(node.text);

      // Apply text marks (bold, italic, links, etc.)
      if (node.marks && Array.isArray(node.marks)) {
        for (const mark of node.marks) {
          const markObj = mark as { type: string; attrs?: { href?: string } };
          switch (markObj.type) {
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
            case 'link': {
              const href = markObj.attrs?.href || '#';
              text = `<a href="${WebviewHelper.escapeHtml(href)}" target="_blank">${text}</a>`;
              break;
            }
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
        const attrs = node.attrs as { level?: number } | undefined;
        const level = attrs?.level || 1;
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
        const attrs = node.attrs as { start?: number } | undefined;
        const start = attrs?.start || 1;
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
        const attrs = node.attrs as { language?: string } | undefined;
        const language = attrs?.language || '';
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
        const attrs = node.attrs as { colspan?: number; rowspan?: number } | undefined;
        const colspan = attrs?.colspan || 1;
        const rowspan = attrs?.rowspan || 1;
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
        const attrs = node.attrs as { src?: string; alt?: string; title?: string } | undefined;
        const src = attrs?.src || '';
        const alt = attrs?.alt || '';
        const title = attrs?.title || '';

        if (src) {
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

}
