import * as vscode from 'vscode';
import * as path from 'path';
import { SyncService } from '../services/syncService';
import { ConfigService } from '../services/configService';
import { MarkdownRenderer } from '../utils/markdownRenderer';
import { DocumentEditorWebview } from '../webviews/documentEditorWebview';

export class BacklogDocumentEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'backlog.bdocEditor';

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly syncService: SyncService,
    private readonly configService: ConfigService,
    private readonly markdownRenderer: MarkdownRenderer
  ) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    const text = document.getText();
    const { meta, body } = this.syncService.parseFrontmatter(text);
    const title = meta.title || path.basename(document.uri.fsPath, '.bdoc');

    webviewPanel.webview.html = DocumentEditorWebview.getWebviewContent(
      webviewPanel.webview,
      this.context.extensionUri,
      {
        title,
        backlogId: meta.backlog_id || '',
        project: meta.project || '',
        syncedAt: meta.synced_at || '',
        updatedAt: meta.updated_at || '',
        filePath: document.uri.fsPath,
      },
      body
    );

    webviewPanel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'save': {
            try {
              const currentText = document.getText();
              const { meta: currentMeta } = this.syncService.parseFrontmatter(currentText);

              const frontmatter = this.syncService.buildFrontmatter({
                title: currentMeta.title || title,
                backlog_id: currentMeta.backlog_id || '',
                project: currentMeta.project || '',
                synced_at: currentMeta.synced_at || '',
                updated_at: currentMeta.updated_at || '',
              });

              const newText = frontmatter + message.content;
              const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(currentText.length)
              );

              const edit = new vscode.WorkspaceEdit();
              edit.replace(document.uri, fullRange, newText);
              await vscode.workspace.applyEdit(edit);
              await document.save();

              webviewPanel.webview.postMessage({ type: 'saved' });
            } catch (error) {
              webviewPanel.webview.postMessage({
                type: 'saveError',
                error: error instanceof Error ? error.message : String(error),
              });
            }
            break;
          }
          case 'requestPreview': {
            const html = this.markdownRenderer.renderMarkdown(message.content);
            webviewPanel.webview.postMessage({ type: 'previewReady', html });
            break;
          }
          case 'copyAndOpen': {
            await vscode.env.clipboard.writeText(message.content);
            const domain = this.configService.getDomain();
            const currentMeta = this.syncService.parseFrontmatter(document.getText()).meta;
            if (domain && currentMeta.backlog_id) {
              const hostOnly = domain.replace(/https?:\/\//, '').split('/')[0];
              const url = `https://${hostOnly}/alias/document/${currentMeta.backlog_id}`;
              await vscode.env.openExternal(vscode.Uri.parse(url));
            }
            vscode.window.showInformationMessage(
              'コンテンツをクリップボードにコピーしました。'
            );
            break;
          }
        }
      },
      undefined,
      this.context.subscriptions
    );
  }
}
