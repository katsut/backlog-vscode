import * as vscode from 'vscode';
import { Entity } from 'backlog-js';
import { DocumentSyncMapping } from '../types/backlog';
import { WebviewHelper } from './common';

type DocumentTreeNode = Entity.Document.DocumentTreeNode;
type DocumentTree = Entity.Document.DocumentTree;

export class SyncMappingEditorWebview {
  static getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    projects: Entity.Project.Project[],
    documentTree: DocumentTree | null,
    mappings: DocumentSyncMapping[],
    currentProjectKey?: string
  ): string {
    const nonce = WebviewHelper.getNonce();

    const projectOptions = projects
      .map(
        (p) =>
          `<option value="${p.id}" data-key="${WebviewHelper.escapeHtml(p.projectKey)}" ${p.projectKey === currentProjectKey ? 'selected' : ''}>${WebviewHelper.escapeHtml(p.projectKey)}: ${WebviewHelper.escapeHtml(p.name)}</option>`
      )
      .join('\n');

    const treeHtml = documentTree?.activeTree?.children
      ? this.renderTree(documentTree.activeTree.children, currentProjectKey || '', mappings, 0)
      : '<p class="no-content">プロジェクトを選択してください</p>';

    const mappingsHtml = this.renderMappings(mappings);

    const additionalStyles = `
      .editor-container { max-width: 800px; margin: 0 auto; padding: var(--webview-space-lg); }
      .editor-title { font-size: var(--webview-font-size-xl); font-weight: 600; margin-bottom: var(--webview-space-lg); }

      .project-select-section { margin-bottom: var(--webview-space-xl); }
      .project-select-section label { display: block; font-weight: 600; margin-bottom: var(--webview-space-sm); }
      .project-select-section select {
        width: 100%;
        padding: 6px 8px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border);
        border-radius: var(--webview-radius-sm);
        font-size: var(--webview-font-size-base);
      }

      .section-title { font-size: var(--webview-font-size-lg); font-weight: 600; margin-bottom: var(--webview-space-md); }

      .tree-section { margin-bottom: var(--webview-space-xl); }
      .tree-container {
        border: 1px solid var(--vscode-panel-border);
        border-radius: var(--webview-radius-md);
        padding: var(--webview-space-md);
        max-height: 400px;
        overflow-y: auto;
      }

      .tree-node { padding: 2px 0; }
      .tree-node-row {
        display: flex;
        align-items: center;
        gap: var(--webview-space-sm);
        padding: 4px 6px;
        border-radius: var(--webview-radius-sm);
      }
      .tree-node-row:hover { background: var(--vscode-list-hoverBackground); }
      .tree-node-icon { flex-shrink: 0; width: 18px; text-align: center; }
      .tree-node-name { flex: 1; font-size: var(--webview-font-size-base); }
      .tree-node-mapped {
        font-size: var(--webview-font-size-xs);
        color: var(--vscode-descriptionForeground);
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        padding: 1px 6px;
        border-radius: 10px;
      }
      .tree-children { padding-left: 20px; }

      .btn-select {
        padding: 2px 10px;
        font-size: var(--webview-font-size-sm);
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: var(--webview-radius-sm);
        cursor: pointer;
        flex-shrink: 0;
      }
      .btn-select:hover { background: var(--vscode-button-hoverBackground); }

      .inline-form {
        display: flex;
        align-items: center;
        gap: var(--webview-space-sm);
        padding: 6px;
        margin-top: 4px;
        margin-left: 26px;
        background: var(--vscode-editor-inactiveSelectionBackground);
        border-radius: var(--webview-radius-sm);
      }
      .inline-form input {
        flex: 1;
        padding: 4px 8px;
        background: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border);
        border-radius: var(--webview-radius-sm);
        font-size: var(--webview-font-size-sm);
        font-family: var(--webview-mono-font-family);
      }
      .inline-form .btn-add {
        padding: 4px 12px;
        font-size: var(--webview-font-size-sm);
        background: var(--vscode-button-background);
        color: var(--vscode-button-foreground);
        border: none;
        border-radius: var(--webview-radius-sm);
        cursor: pointer;
      }
      .inline-form .btn-add:hover { background: var(--vscode-button-hoverBackground); }
      .inline-form .btn-cancel {
        padding: 4px 8px;
        font-size: var(--webview-font-size-sm);
        background: transparent;
        color: var(--vscode-descriptionForeground);
        border: 1px solid var(--vscode-input-border);
        border-radius: var(--webview-radius-sm);
        cursor: pointer;
      }

      .mappings-section { margin-bottom: var(--webview-space-xl); }
      .mappings-list { display: flex; flex-direction: column; gap: var(--webview-space-sm); }
      .mapping-item {
        display: flex;
        align-items: center;
        gap: var(--webview-space-md);
        padding: var(--webview-space-sm) var(--webview-space-md);
        background: var(--vscode-editor-inactiveSelectionBackground);
        border-radius: var(--webview-radius-sm);
      }
      .mapping-project {
        font-size: var(--webview-font-size-xs);
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        padding: 1px 6px;
        border-radius: 10px;
        flex-shrink: 0;
      }
      .mapping-doc { font-weight: 500; }
      .mapping-arrow { color: var(--vscode-descriptionForeground); flex-shrink: 0; }
      .mapping-path { font-family: var(--webview-mono-font-family); font-size: var(--webview-font-size-sm); color: var(--vscode-descriptionForeground); }
      .btn-remove {
        margin-left: auto;
        padding: 2px 8px;
        font-size: var(--webview-font-size-sm);
        background: transparent;
        color: var(--vscode-errorForeground);
        border: 1px solid var(--vscode-errorForeground);
        border-radius: var(--webview-radius-sm);
        cursor: pointer;
        flex-shrink: 0;
      }
      .btn-remove:hover { background: var(--vscode-inputValidation-errorBackground); }

      .no-content { color: var(--vscode-descriptionForeground); font-style: italic; padding: var(--webview-space-md); }
    `;

    return `<!DOCTYPE html>
<html lang="ja">
${WebviewHelper.getHtmlHead(webview, extensionUri, 'Document Sync Mapping Editor', additionalStyles, nonce)}
<body>
  <div class="editor-container">
    <h1 class="editor-title">Document Sync Mapping</h1>

    <div class="project-select-section">
      <label for="projectSelect">プロジェクト</label>
      <select id="projectSelect">
        <option value="">-- 選択してください --</option>
        ${projectOptions}
      </select>
    </div>

    <div class="tree-section">
      <div class="section-title">ドキュメントツリー</div>
      <div class="tree-container" id="treeContainer">
        ${treeHtml}
      </div>
    </div>

    <div class="mappings-section">
      <div class="section-title">現在のマッピング</div>
      <div id="mappingsContainer">
        ${mappingsHtml}
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    // Project selection
    document.getElementById('projectSelect').addEventListener('change', function() {
      const option = this.options[this.selectedIndex];
      if (option.value) {
        vscode.postMessage({
          command: 'selectProject',
          projectId: Number(option.value),
          projectKey: option.dataset.key
        });
      }
    });

    // Delegate click events
    document.addEventListener('click', function(e) {
      const target = e.target;

      // Select button
      if (target.classList.contains('btn-select')) {
        const nodeId = target.dataset.nodeId;
        const nodeName = target.dataset.nodeName;
        const existingForm = document.querySelector('.inline-form');
        if (existingForm) existingForm.remove();

        const row = target.closest('.tree-node');
        const form = document.createElement('div');
        form.className = 'inline-form';

        const projectSelect = document.getElementById('projectSelect');
        const projectKey = projectSelect.options[projectSelect.selectedIndex].dataset.key || '';
        const safeName = nodeName.replace(/[<>:"\\/|?*]/g, '-');
        const defaultPath = 'docs/' + projectKey + '/' + safeName;

        form.innerHTML =
          '<input type="text" id="pathInput" value="' + defaultPath + '" placeholder="docs/PROJECT/folder" />' +
          '<button class="btn-add" data-node-id="' + nodeId + '" data-node-name="' + nodeName.replace(/"/g, '&quot;') + '">追加</button>' +
          '<button class="btn-cancel">取消</button>';
        row.appendChild(form);

        const input = form.querySelector('#pathInput');
        input.focus();
        input.select();
      }

      // Add button
      if (target.classList.contains('btn-add')) {
        const input = target.closest('.inline-form').querySelector('input');
        const path = input.value.trim();
        if (!path) return;

        const projectSelect = document.getElementById('projectSelect');
        const projectKey = projectSelect.options[projectSelect.selectedIndex].dataset.key || '';

        vscode.postMessage({
          command: 'addMapping',
          projectKey: projectKey,
          documentNodeId: target.dataset.nodeId,
          documentNodeName: target.dataset.nodeName,
          localPath: path
        });

        const form = target.closest('.inline-form');
        if (form) form.remove();
      }

      // Cancel button
      if (target.classList.contains('btn-cancel')) {
        const form = target.closest('.inline-form');
        if (form) form.remove();
      }

      // Remove button
      if (target.classList.contains('btn-remove')) {
        vscode.postMessage({
          command: 'removeMapping',
          projectKey: target.dataset.projectKey,
          documentNodeId: target.dataset.nodeId
        });
      }
    });

    // Handle Enter key in path input
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && e.target.id === 'pathInput') {
        const addBtn = e.target.closest('.inline-form').querySelector('.btn-add');
        if (addBtn) addBtn.click();
      }
      if (e.key === 'Escape' && e.target.id === 'pathInput') {
        const form = e.target.closest('.inline-form');
        if (form) form.remove();
      }
    });

    // Handle messages from extension
    window.addEventListener('message', function(event) {
      const message = event.data;
      switch (message.type) {
        case 'updateTree':
          document.getElementById('treeContainer').innerHTML = message.treeHtml;
          document.getElementById('mappingsContainer').innerHTML = message.mappingsHtml;
          break;
        case 'updateMappings':
          document.getElementById('mappingsContainer').innerHTML = message.mappingsHtml;
          break;
      }
    });
  </script>
</body>
</html>`;
  }

  private static renderTree(
    nodes: DocumentTreeNode[],
    projectKey: string,
    mappings: DocumentSyncMapping[],
    depth: number
  ): string {
    return nodes
      .map((node) => {
        const hasChildren = node.children && node.children.length > 0;
        const icon = hasChildren ? '📁' : '📄';
        const name = WebviewHelper.escapeHtml(node.name || '');
        const nodeId = WebviewHelper.escapeHtml(node.id?.toString() || '');

        const mapping = mappings.find(
          (m) => m.projectKey === projectKey && m.documentNodeId === nodeId
        );

        const mappedBadge = mapping
          ? `<span class="tree-node-mapped">${WebviewHelper.escapeHtml(mapping.localPath)}</span>`
          : '';

        const selectBtn = hasChildren
          ? `<button class="btn-select" data-node-id="${nodeId}" data-node-name="${name}">選択</button>`
          : '';

        const childrenHtml =
          hasChildren
            ? `<div class="tree-children">${this.renderTree(node.children!, projectKey, mappings, depth + 1)}</div>`
            : '';

        return `
          <div class="tree-node">
            <div class="tree-node-row">
              <span class="tree-node-icon">${icon}</span>
              <span class="tree-node-name">${name}</span>
              ${mappedBadge}
              ${selectBtn}
            </div>
            ${childrenHtml}
          </div>`;
      })
      .join('');
  }

  static renderMappings(mappings: DocumentSyncMapping[]): string {
    if (mappings.length === 0) {
      return '<p class="no-content">マッピングはまだ設定されていません</p>';
    }

    const items = mappings
      .map((m) => {
        const projectKey = WebviewHelper.escapeHtml(m.projectKey);
        const docName = WebviewHelper.escapeHtml(m.documentNodeName || m.documentNodeId);
        const localPath = WebviewHelper.escapeHtml(m.localPath);
        const nodeId = WebviewHelper.escapeHtml(m.documentNodeId);

        return `
          <div class="mapping-item">
            <span class="mapping-project">${projectKey}</span>
            <span class="mapping-doc">${docName}</span>
            <span class="mapping-arrow">→</span>
            <span class="mapping-path">${localPath}</span>
            <button class="btn-remove" data-project-key="${projectKey}" data-node-id="${nodeId}">✕</button>
          </div>`;
      })
      .join('');

    return `<div class="mappings-list">${items}</div>`;
  }
}
