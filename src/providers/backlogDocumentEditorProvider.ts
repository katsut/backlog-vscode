import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { SyncService } from '../services/syncService';
import { BacklogConfig } from '../config/backlogConfig';
import { MarkdownRenderer } from '../utils/markdownRenderer';
import { DocumentEditorWebview } from '../webviews/documentEditorWebview';
export class BacklogDocumentEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'nulab.bdocEditor';

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly syncService: SyncService,
    private readonly configService: BacklogConfig,
    private readonly markdownRenderer: MarkdownRenderer
  ) {}

  /**
   * Resolve local .images/ references in markdown to webview URIs,
   * and resolve any remaining Backlog URLs via API download.
   */
  private resolveLocalImages(content: string, webview: vscode.Webview, docDir: string): string {
    // Replace .images/{id} references with webview URIs
    return content.replace(/!\[([^\]]*)\]\((\.images\/[^)]+)\)/g, (_match, alt, relativePath) => {
      const absolutePath = path.join(docDir, relativePath);
      if (fs.existsSync(absolutePath)) {
        const uri = webview.asWebviewUri(vscode.Uri.file(absolutePath));
        return `![${alt}](${uri})`;
      }
      return _match;
    });
  }

  /**
   * Resolve local image paths in rendered HTML to webview URIs.
   */
  private resolveLocalImagesInHtml(html: string, webview: vscode.Webview, docDir: string): string {
    return html.replace(/src="(\.images\/[^"]+)"/g, (_match, relativePath) => {
      const absolutePath = path.join(docDir, relativePath);
      if (fs.existsSync(absolutePath)) {
        const uri = webview.asWebviewUri(vscode.Uri.file(absolutePath));
        return `src="${uri}"`;
      }
      return _match;
    });
  }

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    const docDir = path.dirname(document.uri.fsPath);

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri, vscode.Uri.file(docDir)],
    };

    const text = document.getText();
    const { meta, body } = this.syncService.parseFrontmatter(text);
    const title = meta.title || path.basename(document.uri.fsPath, '.bdoc');

    // Register message handler BEFORE setting HTML to avoid race condition
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
            // Resolve local .images/ paths, then render markdown
            const resolved = this.resolveLocalImages(message.content, webviewPanel.webview, docDir);
            let html = this.markdownRenderer.renderMarkdown(resolved);
            html = this.resolveLocalImagesInHtml(html, webviewPanel.webview, docDir);
            webviewPanel.webview.postMessage({ type: 'previewReady', html });
            break;
          }
          case 'pull': {
            await vscode.commands.executeCommand(
              'nulab.documentSync.pullFile',
              document.uri.fsPath
            );
            break;
          }
          case 'diff': {
            await vscode.commands.executeCommand('nulab.documentSync.diff', document.uri.fsPath);
            break;
          }
          case 'copyAndOpen': {
            await vscode.env.clipboard.writeText(message.content);
            const domain = this.configService.getDomain();
            const currentMeta = this.syncService.parseFrontmatter(document.getText()).meta;
            if (domain && currentMeta.backlog_id) {
              const hostOnly = domain.replace(/https?:\/\//, '').split('/')[0];
              const projectKey = currentMeta.project || '';
              const url = `https://${hostOnly}/document/${projectKey}/${currentMeta.backlog_id}`;
              await vscode.env.openExternal(vscode.Uri.parse(url));
            }
            vscode.window.showInformationMessage(
              '[Nulab] コンテンツをクリップボードにコピーしました。'
            );
            break;
          }
        }
      },
      undefined,
      this.context.subscriptions
    );

    // Watch for external document changes (e.g., Claude Code editing the file)
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length > 0) {
        const newText = e.document.getText();
        const { body: newBody } = this.syncService.parseFrontmatter(newText);
        webviewPanel.webview.postMessage({ type: 'externalUpdate', content: newBody });
      }
    });
    webviewPanel.onDidDispose(() => changeSubscription.dispose());

    // Pre-render preview HTML with local image resolution
    const resolvedBody = this.resolveLocalImages(body, webviewPanel.webview, docDir);
    let initialPreviewHtml = this.markdownRenderer.renderMarkdown(resolvedBody);
    initialPreviewHtml = this.resolveLocalImagesInHtml(
      initialPreviewHtml,
      webviewPanel.webview,
      docDir
    );

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
      body,
      initialPreviewHtml
    );
  }
}
