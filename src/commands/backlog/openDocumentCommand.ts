import * as vscode from 'vscode';
import { Entity } from 'backlog-js';
import { spawn, ChildProcess } from 'child_process';
import { ServiceContainer } from '../../container';
import { DocumentWebview } from '../../webviews/documentWebview';
import { WebviewHelper } from '../../webviews/common';

/** Find a locally synced .bdoc file by Backlog document ID */
function findSyncedFile(c: ServiceContainer, documentId: string): string | null {
  const mappings = c.fileStore.getDocumentSyncMappings();
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || mappings.length === 0) {
    return null;
  }
  const rootPath = workspaceFolders[0].uri.fsPath;
  const path = require('path');

  for (const mapping of mappings) {
    const localDir = path.resolve(rootPath, mapping.localPath);
    const manifest = c.syncService.loadManifest(localDir);
    for (const [relativePath, entry] of Object.entries(manifest)) {
      if (entry.backlog_id === documentId) {
        return path.join(localDir, relativePath);
      }
    }
  }
  return null;
}

export function registerOpenDocumentCommand(c: ServiceContainer): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand(
      'nulab.openDocument',
      async (document: Entity.Document.DocumentTreeNode) => {
        if (!document) {
          return;
        }

        const documentTitle = document.name || 'Unnamed Document';
        const documentKey = document.id ? document.id.toString() : documentTitle;

        const existingPanel = c.documentPanels.get(documentKey);
        if (existingPanel) {
          existingPanel.reveal(vscode.ViewColumn.One);
          try {
            const projectKey = c.backlogDocumentsProvider.getCurrentProjectKey() || '';
            const documentDetail = await c.backlogApi.getDocument(document.id!.toString());
            existingPanel.webview.html = await DocumentWebview.getWebviewContent(
              existingPanel.webview,
              c.context.extensionUri,
              documentDetail,
              c.backlogConfig.getBaseUrl(),
              c.backlogApi,
              projectKey
            );
          } catch (error) {
            console.error('Error refreshing existing document panel:', error);
          }
          return;
        }

        const panel = vscode.window.createWebviewPanel(
          'backlogDocument',
          `Document: ${documentTitle}`,
          vscode.ViewColumn.One,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [c.context.extensionUri],
          }
        );

        c.documentPanels.set(documentKey, panel);

        try {
          const projectKey = c.backlogDocumentsProvider.getCurrentProjectKey() || '';

          if (!document.id) {
            throw new Error('Document ID is required to load document details');
          }

          const documentDetail = await c.backlogApi.getDocument(document.id.toString());

          panel.webview.html = await DocumentWebview.getWebviewContent(
            panel.webview,
            c.context.extensionUri,
            documentDetail,
            c.backlogConfig.getBaseUrl(),
            c.backlogApi,
            projectKey
          );

          // Per-panel Claude state
          let claudeProc: ChildProcess | null = null;
          let claudeSessionId = `doc-${Date.now()}`;
          let isFirstTurn = true;
          let latestDocument: Entity.Document.Document = documentDetail;

          function buildDocumentContext(doc: Entity.Document.Document): string {
            return [
              'あなたはBacklogドキュメントの編集支援AIです。',
              '以下のドキュメントの内容を把握し、編集・改善の提案を行ってください。',
              '',
              `## ドキュメント: ${doc.title || 'Unnamed Document'}`,
              '',
              doc.plain || '(コンテンツなし)',
            ].join('\n');
          }

          function runClaudeTurn(userMessage: string, model?: string): void {
            panel.webview.postMessage({ command: 'chatTurnStart' });

            const env: NodeJS.ProcessEnv = { ...process.env };
            if (!env.PATH || !env.PATH.includes('/opt/homebrew/bin')) {
              env.PATH = `/opt/homebrew/bin:/usr/local/bin:${env.PATH || ''}`;
            }

            const args = [
              '--print',
              '--verbose',
              '--output-format',
              'stream-json',
              '--include-partial-messages',
            ];
            if (isFirstTurn) {
              args.push('--system-prompt', buildDocumentContext(latestDocument));
            }
            if (model) {
              args.push('--model', model);
            }
            args.push(isFirstTurn ? '--session-id' : '--resume', claudeSessionId, userMessage);
            isFirstTurn = false;

            claudeProc = spawn('claude', args, { env });
            claudeProc.stdin?.end();

            let accumulated = '';
            claudeProc.stdout?.on('data', (data: Buffer) => {
              for (const line of data.toString().split('\n')) {
                if (!line.trim()) {
                  continue;
                }
                try {
                  const json = JSON.parse(line);
                  if (json.type === 'assistant' && Array.isArray(json.message?.content)) {
                    for (const block of json.message.content) {
                      if (block.type === 'text') {
                        accumulated = block.text;
                        panel.webview.postMessage({ command: 'chatChunk', text: accumulated });
                      }
                    }
                  }
                } catch {
                  /* non-JSON lines ignored */
                }
              }
            });
            claudeProc.on('close', () => {
              claudeProc = null;
              panel.webview.postMessage({ command: 'chatDone' });
            });
            claudeProc.on('error', (err: Error) => {
              claudeProc = null;
              panel.webview.postMessage({ command: 'chatError', text: err.message });
            });
          }

          panel.onDidDispose(() => {
            claudeProc?.kill();
            claudeProc = null;
          });

          panel.webview.onDidReceiveMessage(
            async (message) => {
              switch (message.command) {
                case 'startClaudeSession':
                  isFirstTurn = true;
                  claudeSessionId = `doc-${Date.now()}`;
                  break;
                case 'sendChatMessage':
                  if (message.text?.trim()) {
                    runClaudeTurn(message.text.trim(), message.model);
                  }
                  break;
                case 'stopClaude':
                  claudeProc?.kill();
                  claudeProc = null;
                  break;
                case 'openExternal':
                  vscode.env.openExternal(vscode.Uri.parse(message.url));
                  break;
                case 'refreshDocument':
                  try {
                    const refreshedDocument = await c.backlogApi.getDocument(message.documentId);
                    latestDocument = refreshedDocument;
                    const refreshProjectKey =
                      c.backlogDocumentsProvider.getCurrentProjectKey() || '';
                    panel.webview.html = await DocumentWebview.getWebviewContent(
                      panel.webview,
                      c.context.extensionUri,
                      refreshedDocument,
                      c.backlogConfig.getBaseUrl(),
                      c.backlogApi,
                      refreshProjectKey
                    );
                  } catch (error) {
                    console.error('Error refreshing document:', error);
                    vscode.window.showErrorMessage(`[Nulab] Failed to refresh document: ${error}`);
                  }
                  break;
                case 'switchMode': {
                  const docId = message.documentId;
                  if (message.mode === 'pull') {
                    await vscode.commands.executeCommand('nulab.documentSync.pull');
                    break;
                  }
                  if (message.mode === 'copyOpen') {
                    const localFile = findSyncedFile(c, docId);
                    if (localFile) {
                      await vscode.commands.executeCommand(
                        'nulab.documentSync.copyAndOpen',
                        localFile
                      );
                    } else {
                      vscode.window.showWarningMessage(
                        '[Nulab] ローカルファイルが見つかりません。先に Pull してください。'
                      );
                    }
                    break;
                  }
                  const syncedFile = findSyncedFile(c, docId);
                  if (!syncedFile) {
                    vscode.window.showWarningMessage(
                      '[Nulab] ローカルファイルが見つかりません。先に Pull してください。'
                    );
                    break;
                  }
                  if (message.mode === 'edit') {
                    await vscode.commands.executeCommand(
                      'vscode.open',
                      vscode.Uri.file(syncedFile)
                    );
                  } else if (message.mode === 'diff') {
                    await vscode.commands.executeCommand('nulab.documentSync.diff', syncedFile);
                  }
                  break;
                }
              }
            },
            undefined,
            c.context.subscriptions
          );
        } catch (error) {
          panel.webview.html = WebviewHelper.getErrorWebviewContent(
            `Failed to load document: ${error}`
          );
        }
      }
    ),
  ];
}
