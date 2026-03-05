import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
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

    // Per-panel Claude state
    const self = this;
    let claudeProc: ChildProcess | null = null;
    let claudeSessionId = `bdoc-${Date.now()}`;
    let isFirstTurn = true;

    function runClaudeTurn(userMessage: string, model?: string): void {
      webviewPanel.webview.postMessage({ command: 'chatTurnStart' });

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
        const currentText = document.getText();
        const { meta, body } = self.syncService.parseFrontmatter(currentText);
        const docTitle = meta.title || path.basename(document.uri.fsPath, '.bdoc');
        const systemPrompt = [
          'あなたはBacklogドキュメントの編集支援AIです。',
          '以下のドキュメントの内容を把握し、編集・改善の提案を行ってください。',
          '',
          `## ドキュメント: ${docTitle}`,
          '',
          body || '(コンテンツなし)',
        ].join('\n');
        args.push('--system-prompt', systemPrompt);
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
          if (!line.trim()) continue;
          try {
            const json = JSON.parse(line);
            if (json.type === 'assistant' && Array.isArray(json.message?.content)) {
              for (const block of json.message.content) {
                if (block.type === 'text') {
                  accumulated = block.text;
                  webviewPanel.webview.postMessage({ command: 'chatChunk', text: accumulated });
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
        webviewPanel.webview.postMessage({ command: 'chatDone' });
      });
      claudeProc.on('error', (err: Error) => {
        claudeProc = null;
        webviewPanel.webview.postMessage({ command: 'chatError', text: err.message });
      });
    }

    webviewPanel.onDidDispose(() => {
      claudeProc?.kill();
      claudeProc = null;
    });

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
          case 'startClaudeSession':
            isFirstTurn = true;
            claudeSessionId = `bdoc-${Date.now()}`;
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
