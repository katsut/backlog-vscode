import * as vscode from 'vscode';
import { WebviewHelper } from '../common';
import { MarkdownRenderer } from '../../utils/markdownRenderer';
import { BacklogApiService } from '../../services/backlogApi';
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
    baseUrl: string | undefined,
    backlogApi: BacklogApiService,
    projectKey?: string
  ): Promise<string> {
    const nonce = WebviewHelper.getNonce();

    // Ensure baseUrl has https:// protocol
    const fullBaseUrl = baseUrl
      ? baseUrl.startsWith('http')
        ? baseUrl
        : `https://${baseUrl}`
      : null;
    const docUrl =
      fullBaseUrl && document.id && projectKey
        ? `${fullBaseUrl}/document/${projectKey}/${document.id}`
        : '#';

    // Get the display title, handling both tree nodes and document entities
    const displayTitle = document.title || 'Unnamed Document';

    // Convert document content if available
    const contentHtml = await this.convertDocumentContent(document, baseUrl, backlogApi);

    const additionalStyles = `
        /* Document-specific styles */
        .content-body {
          overflow-x: auto;
          max-width: 100%;
        }
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

        /* Page-specific layout override */
        .page-layout {
          height: calc(100vh - 140px);
        }

        /* Mode toolbar */
        .mode-toolbar {
          display: flex;
          align-items: center;
          gap: 0;
          margin-bottom: 4px;
          border-bottom: 1px solid var(--vscode-panel-border);
          padding-bottom: 0;
        }
        .mode-tabs {
          display: flex;
          gap: 2px;
          flex: 1;
        }
        .mode-tab {
          padding: 5px 14px;
          border: none;
          background: transparent;
          color: var(--vscode-foreground);
          opacity: 0.6;
          cursor: pointer;
          font-size: 13px;
          border-bottom: 2px solid transparent;
          margin-bottom: -1px;
          font-family: var(--vscode-font-family);
        }
        .mode-tab:hover {
          opacity: 0.9;
        }
        .mode-tab.active {
          opacity: 1;
          border-bottom-color: var(--vscode-focusBorder);
        }
        .mode-actions {
          display: flex;
          gap: 4px;
          padding: 0 4px 2px;
        }
        .mode-action-btn {
          padding: 3px 10px;
          border: none;
          background: var(--vscode-button-secondaryBackground);
          color: var(--vscode-button-secondaryForeground);
          cursor: pointer;
          font-size: 12px;
          border-radius: 3px;
          font-family: var(--vscode-font-family);
        }
        .mode-action-btn:hover {
          background: var(--vscode-button-secondaryHoverBackground);
        }
    `;

    return `<!DOCTYPE html>
      <html lang="en">
      ${WebviewHelper.getHtmlHead(
        webview,
        extensionUri,
        `Document: ${displayTitle}`,
        additionalStyles,
        nonce
      )}
      <body>
        <div class="webview-header">
          <div class="mode-toolbar">
            <div class="mode-tabs">
              <button class="mode-tab" id="modeEdit" title="Edit document">Edit</button>
              <button class="mode-tab active" id="modePreview" title="Preview document">Preview</button>
              <button class="mode-tab" id="modeDiff" title="Diff with remote">Diff</button>
            </div>
            <div class="mode-actions">
              <button class="mode-action-btn" id="actionClaude" title="Chat with Claude">✦ Claude</button>
              <button class="mode-action-btn" id="actionPull" title="Pull from Backlog">Pull</button>
              <button class="mode-action-btn" id="actionCopyOpen" title="Copy to clipboard & open in Backlog">Copy&Open</button>
            </div>
          </div>
          <h1>
            ${WebviewHelper.escapeHtml(displayTitle)}
            <button class="refresh-button" id="refreshButton" title="Refresh document content">
              <span class="codicon codicon-refresh"></span>
            </button>
          </h1>
          <div class="webview-meta">
            ${
              document.updated
                ? `<span class="meta-item">Updated: ${new Date(
                    document.updated
                  ).toLocaleDateString()}</span>`
                : ''
            }
            ${
              document.updatedUser
                ? `<span class="meta-item">by ${WebviewHelper.escapeHtml(
                    document.updatedUser.name
                  )}</span>`
                : ''
            }
            ${
              fullBaseUrl && document.id
                ? `<a href="#" class="external-link" data-url="${docUrl}">Open in Backlog</a>`
                : ''
            }
          </div>
        </div>

        <div class="page-layout">
          <div class="main-content">
            <div class="content-section">
              <div class="content-body markdown-content">
                ${contentHtml}
              </div>
            </div>
          </div>

          <div class="panel-resizer" id="panelResizer"></div>

          <div class="claude-chat-section" id="claudeChatSection">
            <div class="claude-chat-header">
              <h3>✦ Claude Code</h3>
              <div class="header-actions">
                <select id="modelSelect" class="model-select" title="モデル選択">
                  <option value="">Default</option>
                  <option value="claude-opus-4-6">Opus</option>
                  <option value="claude-sonnet-4-6">Sonnet</option>
                  <option value="claude-haiku-4-5-20251001">Haiku</option>
                </select>
                <button class="claude-stop-btn" id="claudeStopBtn" style="display:none;">停止</button>
              </div>
            </div>
            <div class="chat-messages" id="chatMessages"></div>
            <div class="chat-input-row">
              <textarea class="chat-input" id="chatInput" placeholder="メッセージを入力... (Cmd+Enter で送信)" rows="2"></textarea>
              <button class="chat-send-btn" id="chatSendBtn">送信</button>
            </div>
          </div>
        </div><!-- /.page-layout -->

        <script nonce="${nonce}">
          const vscode = acquireVsCodeApi();

          // Mode tab clicks
          document.getElementById('modeEdit').addEventListener('click', function() {
            vscode.postMessage({ command: 'switchMode', mode: 'edit', documentId: '${
              document.id || ''
            }' });
          });
          document.getElementById('modeDiff').addEventListener('click', function() {
            vscode.postMessage({ command: 'switchMode', mode: 'diff', documentId: '${
              document.id || ''
            }' });
          });
          document.getElementById('actionPull').addEventListener('click', function() {
            vscode.postMessage({ command: 'switchMode', mode: 'pull', documentId: '${
              document.id || ''
            }' });
          });
          document.getElementById('actionCopyOpen').addEventListener('click', function() {
            vscode.postMessage({ command: 'switchMode', mode: 'copyOpen', documentId: '${
              document.id || ''
            }' });
          });
          document.getElementById('actionClaude').addEventListener('click', function() {
            vscode.postMessage({ command: 'startClaudeSession' });
          });
          document.getElementById('claudeStopBtn').addEventListener('click', function() {
            vscode.postMessage({ command: 'stopClaude' });
          });

          const chatMessages = document.getElementById('chatMessages');
          const chatInput = document.getElementById('chatInput');
          const chatSendBtn = document.getElementById('chatSendBtn');
          const claudeStopBtn = document.getElementById('claudeStopBtn');
          const modelSelect = document.getElementById('modelSelect');
          let currentAssistantMsg = null;

          function addMessage(role, text) {
            const div = document.createElement('div');
            div.className = 'chat-msg ' + role;
            div.textContent = text;
            chatMessages.appendChild(div);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            return div;
          }

          function sendChatMessage() {
            const text = chatInput.value.trim();
            if (!text) return;
            addMessage('user', text);
            chatInput.value = '';
            chatInput.style.height = '';
            chatSendBtn.disabled = true;
            vscode.postMessage({ command: 'sendChatMessage', text, model: modelSelect.value || undefined });
          }
          chatSendBtn.addEventListener('click', sendChatMessage);
          chatInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendChatMessage(); }
          });
          chatInput.addEventListener('input', function() {
            this.style.height = 'auto';
            this.style.height = Math.min(this.scrollHeight, 120) + 'px';
          });

          window.addEventListener('message', function(event) {
            const msg = event.data;
            if (msg.command === 'chatTurnStart') {
              currentAssistantMsg = addMessage('assistant', '');
              claudeStopBtn.style.display = 'inline-block';
              chatSendBtn.disabled = true;
            }
            if (msg.command === 'chatChunk') {
              if (currentAssistantMsg) {
                currentAssistantMsg.textContent = msg.text;
                chatMessages.scrollTop = chatMessages.scrollHeight;
              }
            }
            if (msg.command === 'chatDone') {
              currentAssistantMsg = null;
              claudeStopBtn.style.display = 'none';
              chatSendBtn.disabled = false;
              chatInput.focus();
            }
            if (msg.command === 'chatError') {
              if (currentAssistantMsg) {
                currentAssistantMsg.className = 'chat-msg error';
                currentAssistantMsg.textContent = 'Error: ' + msg.text;
              } else {
                addMessage('error', 'Error: ' + msg.text);
              }
              currentAssistantMsg = null;
              claudeStopBtn.style.display = 'none';
              chatSendBtn.disabled = false;
            }
            if (msg.command === 'refreshDocument') {
              vscode.postMessage({ command: 'refreshDocument', documentId: '${
                document.id || ''
              }' });
            }
          });

          // Panel resizer drag logic
          (function() {
            const resizer = document.getElementById('panelResizer');
            const chatSection = document.getElementById('claudeChatSection');
            let startX = 0;
            let startWidth = 0;
            resizer.addEventListener('mousedown', function(e) {
              startX = e.clientX;
              startWidth = chatSection.getBoundingClientRect().width;
              resizer.classList.add('dragging');
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
              function onMove(e) {
                const delta = startX - e.clientX;
                const newWidth = Math.max(200, Math.min(800, startWidth + delta));
                chatSection.style.width = newWidth + 'px';
              }
              function onUp() {
                resizer.classList.remove('dragging');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
              }
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            });
          })();

          // Handle all clicks
          document.addEventListener('click', function(event) {
            const target = event.target;
            if (target.closest('#refreshButton')) {
              event.preventDefault();
              event.stopPropagation();
              vscode.postMessage({ command: 'refreshDocument', documentId: '${
                document.id || ''
              }' });
              return false;
            }
            const linkTarget = target.closest('a[data-url]');
            if (linkTarget) {
              event.preventDefault();
              event.stopPropagation();
              const url = linkTarget.getAttribute('data-url');
              if (url) { vscode.postMessage({ command: 'openExternal', url }); }
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
  public static async convertDocumentContent(
    document: Entity.Document.Document,
    baseUrl: string | undefined,
    backlogApi: BacklogApiService
  ): Promise<string> {
    // Try ProseMirror JSON first (has proper image node references)
    if (document.json) {
      try {
        const jsonContent =
          typeof document.json === 'string' ? JSON.parse(document.json) : document.json;
        if (jsonContent && jsonContent.type === 'doc') {
          return await this.convertProseMirrorToHtml(jsonContent, baseUrl, backlogApi, document);
        }
      } catch (error) {
        console.error('Failed to parse ProseMirror JSON, falling back to plain:', error);
      }
    }

    // Fallback to plain text / markdown
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
            dataUrl: dataUrl,
          });
        } catch (error) {
          console.error(
            `Failed to download attachment ${attachment.id} (${attachment.name}):`,
            error
          );
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
    baseUrl: string | undefined,
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
            html += await this.convertProseMirrorToHtml(child, baseUrl, backlogApi, document);
          }
        }
        break;

      case 'paragraph':
        html += '<p>';
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            html += await this.convertProseMirrorToHtml(child, baseUrl, backlogApi, document);
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
            html += await this.convertProseMirrorToHtml(child, baseUrl, backlogApi, document);
          }
        }
        html += `</${headingTag}>`;
        break;
      }

      case 'bulletList':
        html += '<ul>';
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            html += await this.convertProseMirrorToHtml(child, baseUrl, backlogApi, document);
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
            html += await this.convertProseMirrorToHtml(child, baseUrl, backlogApi, document);
          }
        }
        html += '</ol>';
        break;
      }

      case 'listItem':
        html += '<li>';
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            html += await this.convertProseMirrorToHtml(child, baseUrl, backlogApi, document);
          }
        }
        html += '</li>';
        break;

      case 'blockquote':
        html += '<blockquote>';
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            html += await this.convertProseMirrorToHtml(child, baseUrl, backlogApi, document);
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
            html += await this.convertProseMirrorToHtml(child, baseUrl, backlogApi, document);
          }
        }
        html += '</code></pre>';
        break;
      }

      case 'table':
        html += '<table class="document-table">';
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            html += await this.convertProseMirrorToHtml(child, baseUrl, backlogApi, document);
          }
        }
        html += '</table>';
        break;

      case 'tableRow':
        html += '<tr>';
        if (node.content && Array.isArray(node.content)) {
          for (const child of node.content) {
            html += await this.convertProseMirrorToHtml(child, baseUrl, backlogApi, document);
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
            html += await this.convertProseMirrorToHtml(child, baseUrl, backlogApi, document);
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
              const attachment = document.attachments?.find((att) => att.id === attachmentId);

              if (attachment) {
                // Download and embed the attachment as base64 data URL
                const base64Image = await this.downloadAndEncodeAttachment(
                  document.id,
                  attachmentId,
                  attachment.name,
                  backlogApi
                );

                if (base64Image) {
                  html += `<img src="${base64Image}" alt="${WebviewHelper.escapeHtml(
                    alt
                  )}" title="${WebviewHelper.escapeHtml(title)}" class="embedded-image">`;
                } else {
                  html += `<div class="attachment-error">Failed to load image attachment: ${WebviewHelper.escapeHtml(
                    attachment.name
                  )}</div>`;
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
            html += await this.convertProseMirrorToHtml(child, baseUrl, backlogApi, document);
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
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      bmp: 'image/bmp',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      ico: 'image/x-icon',
      tiff: 'image/tiff',
      tif: 'image/tiff',

      // Documents
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

      // Text
      txt: 'text/plain',
      html: 'text/html',
      htm: 'text/html',
      css: 'text/css',
      js: 'text/javascript',
      json: 'application/json',
      xml: 'text/xml',

      // Archives
      zip: 'application/zip',
      rar: 'application/x-rar-compressed',
      '7z': 'application/x-7z-compressed',
      tar: 'application/x-tar',
      gz: 'application/gzip',

      // Default
      '': 'application/octet-stream',
    };

    return mimeTypes[extension] || 'application/octet-stream';
  }
}
