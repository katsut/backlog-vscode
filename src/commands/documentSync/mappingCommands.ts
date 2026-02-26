import * as vscode from 'vscode';
import * as fs from 'fs';
import { ServiceContainer } from '../../container';
import { SyncMappingEditorWebview } from '../../webviews/syncMappingEditorWebview';
import { DocumentEditorWebview } from '../../webviews/documentEditorWebview';
import { WebviewHelper } from '../../webviews/common';
import { openUrl } from '../../utils/openUrl';

export function registerMappingCommands(c: ServiceContainer): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(
      'nulab.setDocumentSyncMapping',
      async (item?: { document?: { id?: string; name?: string } }) => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
          vscode.window.showWarningMessage('[Nulab] ワークスペースを開いてください。');
          return;
        }

        const projectKey = c.backlogDocumentsProvider.getCurrentProjectKey();
        if (!projectKey) {
          vscode.window.showWarningMessage('[Nulab] プロジェクトをフォーカスしてください。');
          return;
        }

        let documentNodeId: string | undefined;
        let documentNodeName: string | undefined;

        if (item?.document?.id) {
          documentNodeId = item.document.id;
          documentNodeName = item.document.name;
        } else {
          documentNodeId = await vscode.window.showInputBox({
            prompt: 'Backlog ドキュメントノード ID を入力',
            placeHolder: '例: 01934345404771adb2113d7792bb4351',
          });
          if (!documentNodeId) {
            return;
          }
        }

        const suggestedName = (documentNodeName || 'documents').replace(/[<>:"/\\|?*]/g, '-');
        const defaultPath = `docs/${projectKey}/${suggestedName}`;

        const localPath = await vscode.window.showInputBox({
          prompt: 'ワークスペースからの相対パスを入力',
          value: defaultPath,
          placeHolder: '例: docs/PROJECT/folder-name',
          validateInput: (value) => {
            if (!value || value.trim().length === 0) {
              return 'パスを入力してください';
            }
            if (value.startsWith('/') || value.includes('..')) {
              return 'ワークスペース内の相対パスを入力してください';
            }
            return null;
          },
        });

        if (!localPath) {
          return;
        }

        c.fileStore.addDocumentSyncMapping({
          localPath,
          projectKey,
          documentNodeId,
          documentNodeName,
        });

        vscode.window.showInformationMessage(
          `[Nulab] マッピングを設定しました: ${localPath} ↔ ${documentNodeName || documentNodeId}`
        );
      }
    ),

    vscode.commands.registerCommand('nulab.editDocumentSyncMapping', async () => {
      const { panel: mappingEditorPanel, isNew } = c.documentEditorPanels.revealOrCreate(
        'mappingEditor',
        () =>
          vscode.window.createWebviewPanel(
            'backlogSyncMappingEditor',
            'Document Sync Mapping',
            vscode.ViewColumn.One,
            {
              enableScripts: true,
              retainContextWhenHidden: true,
              localResourceRoots: [c.context.extensionUri],
            }
          )
      );

      if (!isNew) {
        return;
      }

      try {
        const projects = await c.backlogApi.getProjects();
        const currentProjectKey = c.backlogDocumentsProvider.getCurrentProjectKey();
        let documentTree = null;

        if (currentProjectKey) {
          const project = projects.find((p) => p.projectKey === currentProjectKey);
          if (project) {
            try {
              documentTree = await c.backlogApi.getDocuments(project.id);
            } catch {
              // Documents may be disabled for this project
            }
          }
        }

        const mappings = c.fileStore.getDocumentSyncMappings();
        const favorites = c.backlogConfig.getFavoriteProjects();
        mappingEditorPanel.webview.html = SyncMappingEditorWebview.getWebviewContent(
          mappingEditorPanel.webview,
          c.context.extensionUri,
          projects,
          documentTree,
          mappings,
          currentProjectKey || undefined,
          favorites
        );

        mappingEditorPanel.webview.onDidReceiveMessage(
          async (message) => {
            switch (message.command) {
              case 'selectProject': {
                let tree = null;
                try {
                  tree = await c.backlogApi.getDocuments(message.projectId);
                } catch {
                  // Documents may be disabled for this project
                }
                const currentMappings = c.fileStore.getDocumentSyncMappings();
                mappingEditorPanel.webview.html = SyncMappingEditorWebview.getWebviewContent(
                  mappingEditorPanel.webview,
                  c.context.extensionUri,
                  projects,
                  tree,
                  currentMappings,
                  message.projectKey,
                  c.backlogConfig.getFavoriteProjects()
                );
                break;
              }
              case 'addMapping': {
                c.fileStore.addDocumentSyncMapping({
                  localPath: message.localPath,
                  projectKey: message.projectKey,
                  documentNodeId: message.documentNodeId,
                  documentNodeName: message.documentNodeName,
                });
                let addTree = null;
                try {
                  const proj = projects.find((p) => p.projectKey === message.projectKey);
                  if (proj) {
                    addTree = await c.backlogApi.getDocuments(proj.id);
                  }
                } catch {
                  /* ignore */
                }
                mappingEditorPanel.webview.html = SyncMappingEditorWebview.getWebviewContent(
                  mappingEditorPanel.webview,
                  c.context.extensionUri,
                  projects,
                  addTree,
                  c.fileStore.getDocumentSyncMappings(),
                  message.projectKey,
                  c.backlogConfig.getFavoriteProjects()
                );
                break;
              }
              case 'removeMapping': {
                c.fileStore.removeDocumentSyncMapping(message.projectKey, message.documentNodeId);
                let removeTree = null;
                try {
                  const proj = projects.find((p) => p.projectKey === message.projectKey);
                  if (proj) {
                    removeTree = await c.backlogApi.getDocuments(proj.id);
                  }
                } catch {
                  /* ignore */
                }
                mappingEditorPanel.webview.html = SyncMappingEditorWebview.getWebviewContent(
                  mappingEditorPanel.webview,
                  c.context.extensionUri,
                  projects,
                  removeTree,
                  c.fileStore.getDocumentSyncMappings(),
                  message.projectKey,
                  c.backlogConfig.getFavoriteProjects()
                );
                break;
              }
              case 'updateMappingPath': {
                const allMappings = c.fileStore.getDocumentSyncMappings();
                const existing = allMappings.find(
                  (m) =>
                    m.projectKey === message.projectKey &&
                    m.documentNodeId === message.documentNodeId
                );
                if (existing) {
                  c.fileStore.addDocumentSyncMapping({
                    ...existing,
                    localPath: message.localPath,
                  });
                }
                break;
              }
            }
          },
          undefined,
          c.context.subscriptions
        );
      } catch (error) {
        mappingEditorPanel.webview.html = WebviewHelper.getErrorWebviewContent(
          `Failed to load: ${error}`
        );
      }
    }),

    vscode.commands.registerCommand('nulab.documentSync.edit', async () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (!activeEditor) {
        vscode.window.showWarningMessage('[Nulab] エディタでファイルを開いてください。');
        return;
      }

      const filePath = activeEditor.document.uri.fsPath;
      if (!filePath.endsWith('.bdoc') && !filePath.endsWith('.md')) {
        vscode.window.showWarningMessage('[Nulab] .bdoc または .md ファイルを開いてください。');
        return;
      }

      const existingPanel = c.documentEditorPanels.get(filePath);
      if (existingPanel) {
        existingPanel.reveal(vscode.ViewColumn.One);
        return;
      }

      const path = require('path');
      const text = fs.readFileSync(filePath, 'utf-8');
      const { meta, body } = c.syncService.parseFrontmatter(text);

      const title =
        meta.title || path.basename(filePath, filePath.endsWith('.bdoc') ? '.bdoc' : '.md');

      const docDir = path.dirname(filePath);
      const panel = vscode.window.createWebviewPanel(
        'backlogDocumentEditor',
        `Edit: ${title}`,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [c.context.extensionUri, vscode.Uri.file(docDir)],
        }
      );

      c.documentEditorPanels.set(filePath, panel);

      const resolveLocalImages = (content: string, webview: vscode.Webview) => {
        return content.replace(
          /!\[([^\]]*)\]\((\.images\/[^)]+)\)/g,
          (_m: string, alt: string, rel: string) => {
            const abs = path.join(docDir, rel);
            if (fs.existsSync(abs)) {
              return `![${alt}](${webview.asWebviewUri(vscode.Uri.file(abs))})`;
            }
            return _m;
          }
        );
      };
      const resolveLocalImagesInHtml = (html: string, webview: vscode.Webview) => {
        return html.replace(/src="(\.images\/[^"]+)"/g, (_m: string, rel: string) => {
          const abs = path.join(docDir, rel);
          if (fs.existsSync(abs)) {
            return `src="${webview.asWebviewUri(vscode.Uri.file(abs))}"`;
          }
          return _m;
        });
      };

      const processedBody = resolveLocalImages(body, panel.webview);
      let initialPreviewHtml = c.markdownRenderer.renderMarkdown(processedBody);
      initialPreviewHtml = resolveLocalImagesInHtml(initialPreviewHtml, panel.webview);

      panel.webview.html = DocumentEditorWebview.getWebviewContent(
        panel.webview,
        c.context.extensionUri,
        {
          title,
          backlogId: meta.backlog_id || '',
          project: meta.project || '',
          syncedAt: meta.synced_at || '',
          updatedAt: meta.updated_at || '',
          filePath,
        },
        body,
        initialPreviewHtml
      );

      panel.webview.onDidReceiveMessage(
        async (message) => {
          switch (message.command) {
            case 'save': {
              try {
                const frontmatter = c.syncService.buildFrontmatter({
                  title: meta.title || title,
                  backlog_id: meta.backlog_id || '',
                  project: meta.project || '',
                  synced_at: meta.synced_at || '',
                  updated_at: meta.updated_at || '',
                });
                fs.writeFileSync(filePath, frontmatter + message.content, 'utf-8');
                panel.webview.postMessage({ type: 'saved' });
              } catch (error) {
                panel.webview.postMessage({
                  type: 'saveError',
                  error: error instanceof Error ? error.message : String(error),
                });
              }
              break;
            }
            case 'requestPreview': {
              const resolved = resolveLocalImages(message.content, panel.webview);
              let html = c.markdownRenderer.renderMarkdown(resolved);
              html = resolveLocalImagesInHtml(html, panel.webview);
              panel.webview.postMessage({ type: 'previewReady', html });
              break;
            }
            case 'pull':
              await vscode.commands.executeCommand('nulab.documentSync.pullFile', filePath);
              break;
            case 'diff':
              await vscode.commands.executeCommand('nulab.documentSync.diff', filePath);
              break;
            case 'copyAndOpen': {
              await vscode.env.clipboard.writeText(message.content);
              const domain = c.backlogConfig.getDomain();
              if (domain && meta.backlog_id) {
                const hostOnly = domain.replace(/https?:\/\//, '').split('/')[0];
                const projectKey = meta.project || '';
                const url = `https://${hostOnly}/document/${projectKey}/${meta.backlog_id}`;
                openUrl(url);
              }
              vscode.window.showInformationMessage(
                '[Nulab] コンテンツをクリップボードにコピーしました。'
              );
              break;
            }
          }
        },
        undefined,
        c.context.subscriptions
      );
    }),
  ];
}
