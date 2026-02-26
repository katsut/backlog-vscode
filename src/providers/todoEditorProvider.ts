import * as vscode from 'vscode';
import * as path from 'path';
import { SessionFileService } from '../services/session/sessionFileService';
import { SessionReplyService } from '../services/session/sessionReplyService';
import { BacklogConfig } from '../config/backlogConfig';
import { SlackApiService } from '../services/slackApi';
import { TodoWebview } from '../webviews/todoWebview';
import { SlackMessage } from '../types/workspace';
import { openUrl } from '../utils/openUrl';
import { TodoTreeViewProvider } from './todoTreeViewProvider';
import { SessionCodeLensProvider } from './sessionCodeLensProvider';

export class TodoEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'nulab.todoEditor';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly fileService: SessionFileService,
    private readonly replyService: SessionReplyService,
    private readonly todoProvider: TodoTreeViewProvider,
    private readonly configService: BacklogConfig,
    private readonly slackApi: SlackApiService,
    private readonly sessionCodeLensProvider: SessionCodeLensProvider
  ) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    // Extract todoId from filename: todo-{id}.todomd
    const filename = path.basename(document.uri.fsPath);
    const match = filename.match(/^todo-(.+)\.todomd$/);
    if (!match) {
      webviewPanel.webview.html = '<html><body><p>TODO ファイルを認識できません</p></body></html>';
      return;
    }
    const todoId = match[1];

    // Initial render
    await this.render(webviewPanel, todoId);

    // Watch for document changes (e.g., Claude Code writing to the DRAFT section)
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length > 0) {
        // Re-read draft info and push update to webview
        const draft = this.fileService.getDraftInfo(todoId);
        if (draft) {
          webviewPanel.webview.postMessage({ command: 'updateDraft', draft: draft.content });
        }
      }
    });
    webviewPanel.onDidDispose(() => changeSubscription.dispose());

    // Handle messages from the webview
    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      if (message.command === 'setStatus') {
        this.todoProvider.setStatus(todoId, message.status);
        await this.render(webviewPanel, todoId);
      }
      if (message.command === 'markReplied') {
        this.todoProvider.markReplied(todoId);
        await this.render(webviewPanel, todoId);
      }
      if (message.command === 'saveNotes') {
        this.todoProvider.editNotes(todoId, message.notes);
        vscode.window.showInformationMessage('[Nulab] Notes を保存しました');
      }
      if (message.command === 'delete') {
        this.todoProvider.deleteTodo(todoId);
        webviewPanel.dispose();
      }
      if (message.command === 'openExternal' && message.url) {
        openUrl(message.url);
      }
      if (message.command === 'openSlackThread') {
        const todo = this.todoProvider.findTodoById(todoId);
        const ctx = todo?.context;
        if (ctx?.slackChannel) {
          const ts = ctx.slackThreadTs || ctx.slackMessageTs || '';
          const sender = ctx.slackUserName || 'Thread';
          vscode.commands.executeCommand(
            'workspace.openSlackThread',
            ctx.slackChannel,
            ts,
            `Thread: ${sender}`
          );
        }
      }
      if (message.command === 'startClaudeSession') {
        await vscode.commands.executeCommand('workspace.startClaudeSession', todoId);
        await this.render(webviewPanel, todoId);
      }
      if (message.command === 'refreshDraft') {
        const draft = this.fileService.getDraftInfo(todoId);
        if (draft) {
          webviewPanel.webview.postMessage({ command: 'updateDraft', draft: draft.content });
        }
      }
      if (message.command === 'postDraft') {
        const filePath = this.fileService.getSessionFilePath(todoId);
        const parsed = this.fileService.parseSession(filePath);
        if (!parsed || !parsed.draft.trim()) {
          vscode.window.showWarningMessage('[Nulab] ドラフトが空です');
          return;
        }
        const label =
          parsed.meta.action === 'slack-reply' ? 'Slack に返信' : 'Backlog にコメント投稿';
        const confirm = await vscode.window.showWarningMessage(
          `${label}しますか？`,
          { modal: true },
          label
        );
        if (confirm !== label) {
          return;
        }
        try {
          if (parsed.meta.action === 'backlog-reply') {
            await this.replyService.postBacklogReply(filePath);
          } else if (parsed.meta.action === 'slack-reply') {
            await this.replyService.postSlackReply(filePath);
          }
          this.todoProvider.markReplied(todoId);
          vscode.window.showInformationMessage(`[Nulab] ${label}しました`);
          await this.render(webviewPanel, todoId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`[Nulab] 投稿に失敗: ${msg}`);
        }
      }
      if (message.command === 'discardDraft') {
        const confirm = await vscode.window.showWarningMessage(
          'ドラフトを破棄しますか？',
          { modal: true },
          '破棄'
        );
        if (confirm !== '破棄') {
          return;
        }
        this.fileService.clearDraft(todoId);
        await this.render(webviewPanel, todoId);
        vscode.window.showInformationMessage('[Nulab] ドラフトを破棄しました');
      }
    });
  }

  private async render(panel: vscode.WebviewPanel, todoId: string): Promise<void> {
    const todo = this.todoProvider.findTodoById(todoId);
    if (!todo) {
      panel.webview.html = '<html><body><p>TODO が見つかりません</p></body></html>';
      return;
    }

    // Fetch surrounding Slack messages if this TODO is from Slack
    let slackContextBefore: SlackMessage[] = [];
    let slackContextAfter: SlackMessage[] = [];
    const ctx = todo.context;
    if (
      (ctx?.source === 'slack-mention' || ctx?.source === 'slack-search') &&
      ctx.slackChannel &&
      (ctx.slackThreadTs || ctx.slackMessageTs)
    ) {
      try {
        const ts = ctx.slackThreadTs || ctx.slackMessageTs || '';
        const channelContext = await this.slackApi.getChannelContext(ctx.slackChannel, ts, 3);
        slackContextBefore = channelContext.before;
        slackContextAfter = channelContext.after;
      } catch {
        // Silently ignore - context is optional
      }
    }

    const draft = this.fileService.getDraftInfo(todoId);
    const fullContext = this.fileService.getContextSection(todoId);

    try {
      panel.webview.html = TodoWebview.getWebviewContent(
        panel.webview,
        this.extensionUri,
        todo,
        this.configService.getBaseUrl(),
        slackContextBefore,
        slackContextAfter,
        draft,
        fullContext
      );
    } catch {
      // Fallback: render without fullContext if markdown processing fails
      panel.webview.html = TodoWebview.getWebviewContent(
        panel.webview,
        this.extensionUri,
        todo,
        this.configService.getBaseUrl(),
        slackContextBefore,
        slackContextAfter,
        draft
      );
    }
  }
}
