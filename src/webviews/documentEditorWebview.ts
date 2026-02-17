import * as vscode from 'vscode';
import { WebviewHelper } from './common';

export interface DocumentEditorMeta {
  title: string;
  backlogId: string;
  project: string;
  syncedAt: string;
  updatedAt: string;
  filePath: string;
}

export class DocumentEditorWebview {
  static getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    meta: DocumentEditorMeta,
    content: string,
    initialPreviewHtml?: string
  ): string {
    const nonce = WebviewHelper.getNonce();

    const escapedContent = WebviewHelper.escapeHtml(content);
    const escapedTitle = WebviewHelper.escapeHtml(meta.title);
    const escapedProject = WebviewHelper.escapeHtml(meta.project);
    const syncedDate = meta.syncedAt
      ? new Date(meta.syncedAt).toLocaleString('ja-JP')
      : '';

    const hasBacklogId = !!meta.backlogId;

    const additionalStyles = `
      .editor-wrapper {
        display: flex;
        flex-direction: column;
        height: 100vh;
        overflow: hidden;
      }

      .toolbar {
        display: flex;
        align-items: center;
        gap: var(--webview-space-sm);
        padding: var(--webview-space-sm) var(--webview-space-md);
        border-bottom: 1px solid var(--vscode-panel-border);
        flex-shrink: 0;
        flex-wrap: wrap;
      }
      .toolbar-left {
        display: flex;
        align-items: center;
        gap: var(--webview-space-sm);
        flex: 1;
        min-width: 0;
      }
      .toolbar-right {
        display: flex;
        align-items: center;
        gap: var(--webview-space-xs);
        flex-shrink: 0;
      }
      .doc-title {
        font-weight: 600;
        font-size: var(--webview-font-size-base);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .project-badge {
        font-size: var(--webview-font-size-xs);
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        padding: 1px 6px;
        border-radius: 10px;
        flex-shrink: 0;
      }
      .sync-info {
        font-size: var(--webview-font-size-xs);
        color: var(--vscode-descriptionForeground);
        flex-shrink: 0;
      }
      .dirty-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--vscode-inputValidation-warningBorder);
        flex-shrink: 0;
        display: none;
      }
      .dirty-dot.visible { display: inline-block; }

      /* Tab switcher for Edit/Preview */
      .tab-group {
        display: inline-flex;
        border: 1px solid var(--vscode-panel-border);
        border-radius: var(--webview-radius-sm);
        overflow: hidden;
      }
      .tab-btn {
        padding: 3px 12px;
        font-size: var(--webview-font-size-sm);
        background: transparent;
        color: var(--vscode-descriptionForeground);
        border: none;
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.1s, color 0.1s;
      }
      .tab-btn:hover { background: var(--vscode-list-hoverBackground); }
      .tab-btn.active {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      .tab-btn + .tab-btn {
        border-left: 1px solid var(--vscode-panel-border);
      }

      /* Action buttons */
      .action-btn {
        padding: 3px 10px;
        font-size: var(--webview-font-size-sm);
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        border: none;
        border-radius: var(--webview-radius-sm);
        cursor: pointer;
        white-space: nowrap;
      }
      .action-btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
      .action-btn.primary {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      .action-btn.primary:hover { background: var(--vscode-button-hoverBackground); }
      .toolbar-separator {
        width: 1px;
        height: 18px;
        background: var(--vscode-panel-border);
        margin: 0 2px;
      }

      .content-area {
        flex: 1;
        overflow: hidden;
        position: relative;
      }

      #editor, #preview { display: none; }
      .mode-edit #editor { display: block; }
      .mode-preview #preview { display: block; }

      #editor {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        padding: var(--webview-space-md) var(--webview-space-lg);
        background: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        border: none;
        outline: none;
        resize: none;
        font-family: var(--vscode-editor-font-family, 'Menlo', 'Monaco', 'Courier New', monospace);
        font-size: var(--vscode-editor-font-size, 13px);
        line-height: 1.6;
        tab-size: 2;
      }

      #preview {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        padding: var(--webview-space-md) var(--webview-space-lg);
        overflow-y: auto;
        background: linear-gradient(135deg, rgba(46, 160, 67, 0.03) 0%, rgba(46, 160, 67, 0.06) 100%);
        border-left: 3px solid rgba(46, 160, 67, 0.25);
      }
      #preview .markdown-image {
        max-width: 100%;
        height: auto;
        border-radius: var(--webview-radius-sm);
      }

      .status-bar {
        display: flex;
        align-items: center;
        gap: var(--webview-space-md);
        padding: 2px var(--webview-space-md);
        border-top: 1px solid var(--vscode-panel-border);
        font-size: var(--webview-font-size-xs);
        color: var(--vscode-descriptionForeground);
        flex-shrink: 0;
      }
    `;

    return `<!DOCTYPE html>
<html lang="ja">
${WebviewHelper.getHtmlHead(webview, extensionUri, `Edit: ${meta.title}`, additionalStyles, nonce)}
<body>
  <div class="editor-wrapper">
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="dirty-dot" id="dirtyDot" title="未保存の変更があります"></span>
        <span class="doc-title">${escapedTitle}</span>
        <span class="project-badge">${escapedProject}</span>
        ${syncedDate ? `<span class="sync-info">Synced: ${syncedDate}</span>` : ''}
      </div>
      <div class="toolbar-right">
        <div class="tab-group">
          <button class="tab-btn" id="btnEdit">Edit</button>
          <button class="tab-btn active" id="btnPreview">Preview</button>
        </div>
        ${hasBacklogId ? `<span class="toolbar-separator"></span>
        <button class="action-btn" id="btnDiff">Diff</button>
        <button class="action-btn primary" id="btnCopyOpen">Copy &amp; Open</button>` : ''}
      </div>
    </div>

    <div class="content-area mode-preview" id="contentArea">
      <textarea id="editor" spellcheck="false">${escapedContent}</textarea>
      <div id="preview" class="markdown-content">${initialPreviewHtml || ''}</div>
    </div>

    <div class="status-bar">
      <span id="statusText">Ready</span>
      <span style="flex:1;"></span>
      <span id="charCount"></span>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const contentArea = document.getElementById('contentArea');
    const editor = document.getElementById('editor');
    const preview = document.getElementById('preview');
    const dirtyDot = document.getElementById('dirtyDot');
    const statusText = document.getElementById('statusText');
    const charCount = document.getElementById('charCount');
    const btnEdit = document.getElementById('btnEdit');
    const btnPreview = document.getElementById('btnPreview');
    const btnDiff = document.getElementById('btnDiff');
    const btnCopyOpen = document.getElementById('btnCopyOpen');

    let isDirty = false;
    let savedContent = editor.value;
    let mode = 'preview';

    function updateCharCount() {
      const len = editor.value.length;
      charCount.textContent = len + ' chars';
    }

    function setDirty(dirty) {
      isDirty = dirty;
      dirtyDot.classList.toggle('visible', dirty);
      statusText.textContent = dirty ? 'Modified' : 'Saved';
    }

    function switchMode(newMode) {
      mode = newMode;
      contentArea.className = 'content-area mode-' + mode;
      if (mode === 'edit') {
        btnEdit.classList.add('active');
        btnPreview.classList.remove('active');
        editor.focus();
      } else {
        btnEdit.classList.remove('active');
        btnPreview.classList.add('active');
        vscode.postMessage({ command: 'requestPreview', content: editor.value });
        preview.innerHTML = '<p style="color:var(--vscode-descriptionForeground);">Rendering...</p>';
      }
    }

    // Editor input
    editor.addEventListener('input', function() {
      if (editor.value !== savedContent) {
        setDirty(true);
      } else {
        setDirty(false);
      }
      updateCharCount();
    });

    // Tab key → insert 2 spaces
    editor.addEventListener('keydown', function(e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = this.selectionStart;
        const end = this.selectionEnd;
        this.value = this.value.substring(0, start) + '  ' + this.value.substring(end);
        this.selectionStart = this.selectionEnd = start + 2;
        this.dispatchEvent(new Event('input'));
      }
    });

    // Toolbar buttons
    btnEdit.addEventListener('click', function() { switchMode('edit'); });
    btnPreview.addEventListener('click', function() { switchMode('preview'); });

    if (btnDiff) {
      btnDiff.addEventListener('click', function() {
        vscode.postMessage({ command: 'diff' });
      });
    }

    if (btnCopyOpen) {
      btnCopyOpen.addEventListener('click', function() {
        vscode.postMessage({ command: 'copyAndOpen', content: editor.value });
      });
    }

    // Keyboard shortcut: Ctrl+S / Cmd+S
    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        vscode.postMessage({ command: 'save', content: editor.value });
      }
    });

    // Messages from extension
    window.addEventListener('message', function(event) {
      const message = event.data;
      switch (message.type) {
        case 'previewReady':
          preview.innerHTML = message.html;
          break;
        case 'saved':
          savedContent = editor.value;
          setDirty(false);
          statusText.textContent = 'Saved';
          break;
        case 'saveError':
          statusText.textContent = 'Save failed: ' + message.error;
          break;
      }
    });

    // Initial state — default to Preview mode
    updateCharCount();
    // Request preview only if not already pre-rendered
    if (!preview.innerHTML.trim()) {
      vscode.postMessage({ command: 'requestPreview', content: editor.value });
    }
  </script>
</body>
</html>`;
  }
}
