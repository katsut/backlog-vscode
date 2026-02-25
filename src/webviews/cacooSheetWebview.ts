import * as vscode from 'vscode';
import { WebviewHelper } from './common';

export class CacooSheetWebview {
  static getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    title: string,
    imageBase64: string,
    diagramUrl?: string
  ): string {
    const nonce = WebviewHelper.getNonce();

    const additionalStyles = `
      .sheet-wrapper {
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
      .sheet-title {
        font-weight: 600;
        font-size: var(--webview-font-size-base);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
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

      .zoom-group {
        display: inline-flex;
        border: 1px solid var(--vscode-panel-border);
        border-radius: var(--webview-radius-sm);
        overflow: hidden;
      }
      .zoom-btn {
        padding: 3px 10px;
        font-size: var(--webview-font-size-sm);
        background: transparent;
        color: var(--vscode-descriptionForeground);
        border: none;
        cursor: pointer;
      }
      .zoom-btn:hover { background: var(--vscode-list-hoverBackground); }
      .zoom-btn.active {
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
      }
      .zoom-btn + .zoom-btn {
        border-left: 1px solid var(--vscode-panel-border);
      }

      .image-area {
        flex: 1;
        overflow: auto;
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding: var(--webview-space-md);
        background: repeating-conic-gradient(
          var(--vscode-editor-background) 0% 25%,
          color-mix(in srgb, var(--vscode-editor-foreground) 5%, var(--vscode-editor-background)) 0% 50%
        ) 50% / 20px 20px;
      }
      .image-area img {
        max-width: none;
        transition: transform 0.15s ease;
      }
      .image-area.fit img {
        max-width: 100%;
        height: auto;
      }
    `;

    const escapedTitle = WebviewHelper.escapeHtml(title);

    return `<!DOCTYPE html>
<html lang="ja">
${WebviewHelper.getHtmlHead(webview, extensionUri, `Cacoo: ${title}`, additionalStyles, nonce)}
<body>
  <div class="sheet-wrapper">
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="sheet-title">${escapedTitle}</span>
      </div>
      <div class="toolbar-right">
        <div class="zoom-group">
          <button class="zoom-btn active" id="btnFit">Fit</button>
          <button class="zoom-btn" id="btn100">100%</button>
          <button class="zoom-btn" id="btn150">150%</button>
        </div>
        ${
          diagramUrl ? `<button class="action-btn primary" id="btnOpen">Open in Cacoo</button>` : ''
        }
      </div>
    </div>

    <div class="image-area fit" id="imageArea">
      <img src="data:image/png;base64,${imageBase64}" alt="${escapedTitle}" />
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const imageArea = document.getElementById('imageArea');
    const img = imageArea.querySelector('img');
    const btnFit = document.getElementById('btnFit');
    const btn100 = document.getElementById('btn100');
    const btn150 = document.getElementById('btn150');
    const btnOpen = document.getElementById('btnOpen');

    function setZoom(mode) {
      [btnFit, btn100, btn150].forEach(b => b.classList.remove('active'));
      if (mode === 'fit') {
        imageArea.classList.add('fit');
        img.style.transform = '';
        btnFit.classList.add('active');
      } else {
        imageArea.classList.remove('fit');
        const scale = mode === '100' ? 1 : 1.5;
        img.style.transform = 'scale(' + scale + ')';
        img.style.transformOrigin = 'top left';
        (mode === '100' ? btn100 : btn150).classList.add('active');
      }
    }

    btnFit.addEventListener('click', () => setZoom('fit'));
    btn100.addEventListener('click', () => setZoom('100'));
    btn150.addEventListener('click', () => setZoom('150'));

    if (btnOpen) {
      btnOpen.addEventListener('click', () => {
        vscode.postMessage({ command: 'openExternal', url: '${diagramUrl || ''}' });
      });
    }
  </script>
</body>
</html>`;
  }
}
