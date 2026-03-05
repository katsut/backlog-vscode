import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { SessionFileService } from '../services/session/sessionFileService';
import { SessionReplyService } from '../services/session/sessionReplyService';
import { BacklogConfig } from '../config/backlogConfig';
import { SlackApiService } from '../services/slackApi';
import { TodoWebview } from '../webviews/todoWebview';
import { SlackMessage } from '../types/workspace';
import { TodoTreeViewProvider } from './todoTreeViewProvider';
import { SessionCodeLensProvider } from './sessionCodeLensProvider';
import { TodoPersistenceService } from '../services/session/todoPersistenceService';
import { MarkdownRenderer } from '../utils/markdownRenderer';

export class TodoEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'nulab.todoEditor';
  private claudeProcesses = new Map<string, ChildProcess>();
  private claudeSessionIds = new Map<string, string>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly fileService: SessionFileService,
    private readonly replyService: SessionReplyService,
    private readonly todoProvider: TodoTreeViewProvider,
    private readonly configService: BacklogConfig,
    private readonly slackApi: SlackApiService,
    private readonly sessionCodeLensProvider: SessionCodeLensProvider,
    private readonly todoPersistence: TodoPersistenceService,
    private readonly outputChannel?: vscode.OutputChannel
  ) {}

  private log(msg: string): void {
    const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
    this.outputChannel?.appendLine(`[${ts}] [ChatSession] ${msg}`);
  }

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

    // Cache Slack context fetched on initial render to avoid re-fetching on every status change
    let cachedSlackBefore: SlackMessage[] = [];
    let cachedSlackAfter: SlackMessage[] = [];

    // Initial render (fetches Slack context and caches it)
    const todo = this.todoProvider.findTodoById(todoId);
    const ctx = todo?.context;
    if (
      (ctx?.source === 'slack-mention' || ctx?.source === 'slack-search') &&
      ctx.slackChannel &&
      (ctx.slackThreadTs || ctx.slackMessageTs)
    ) {
      try {
        const ts = ctx.slackThreadTs || ctx.slackMessageTs || '';
        const channelContext = await this.slackApi.getChannelContext(ctx.slackChannel, ts, 3);
        cachedSlackBefore = channelContext.before;
        cachedSlackAfter = channelContext.after;
      } catch {
        // Silently ignore - context is optional
      }
    }

    await this.render(webviewPanel, todoId, cachedSlackBefore, cachedSlackAfter);

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

    const STATUS_LABELS: Record<string, string> = {
      open: '○ 未着手',
      in_progress: '◉ 進行中',
      waiting: '◷ 待ち',
      done: '✓ 完了',
    };

    // Handle messages from the webview
    webviewPanel.webview.onDidReceiveMessage(async (message) => {
      if (message.command === 'setStatus') {
        this.todoProvider.setStatus(todoId, message.status);
        webviewPanel.webview.postMessage({
          command: 'updateStatus',
          status: message.status,
          statusLabel: STATUS_LABELS[message.status] || message.status,
        });
      }
      if (message.command === 'markReplied') {
        this.todoProvider.markReplied(todoId);
        webviewPanel.webview.postMessage({ command: 'updateReplied' });
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
        vscode.env.openExternal(vscode.Uri.parse(message.url));
      }
      if (message.command === 'openSlackThread') {
        const todo = this.todoProvider.findTodoById(todoId);
        const ctx = todo?.context;
        if (ctx?.slackChannel) {
          const ts = ctx.slackThreadTs || ctx.slackMessageTs || '';
          try {
            const permalink = await this.slackApi.getPermalink(ctx.slackChannel, ts);
            if (permalink) {
              vscode.env.openExternal(vscode.Uri.parse(permalink));
              return;
            }
          } catch {
            // Fall through to internal viewer
          }
          // Fallback: open internal thread viewer
          const sender = ctx.slackUserName || 'Thread';
          vscode.commands.executeCommand(
            'workspace.openSlackThread',
            ctx.slackChannel,
            ts,
            `Thread: ${sender}`
          );
        }
      }
      if (message.command === 'openGoogleDoc') {
        const todo = this.todoProvider.findTodoById(todoId);
        const url = todo?.context?.googleDocUrl;
        if (url) {
          vscode.env.openExternal(vscode.Uri.parse(url));
        }
      }
      if (message.command === 'startClaudeSession') {
        this.log(`message received: startClaudeSession (todoId=${todoId})`);
        this.startChatSession(webviewPanel, todoId);
      }
      if (message.command === 'sendChatMessage') {
        this.log(`message received: sendChatMessage (todoId=${todoId})`);
        let isFirst = false;
        if (!this.claudeSessionIds.has(todoId)) {
          this.claudeSessionIds.set(todoId, randomUUID());
          isFirst = true;
        }
        this.runClaudeTurn(webviewPanel, todoId, message.text, isFirst, message.model);
      }
      if (message.command === 'stopClaude') {
        const proc = this.claudeProcesses.get(todoId);
        if (proc) {
          proc.kill();
          this.claudeProcesses.delete(todoId);
        }
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
          await this.render(webviewPanel, todoId, cachedSlackBefore, cachedSlackAfter);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`[Nulab] 投稿に失敗: ${msg}`);
        }
      }
      if (message.command === 'saveDraft') {
        if (!this.fileService.hasSession(todoId)) {
          const todo = this.todoProvider.findTodoById(todoId);
          if (todo) {
            const meta = this.fileService.todoToMeta(todo, 'none');
            const filePath = this.fileService.getSessionFilePath(todoId);
            this.fileService.writeSessionFile(filePath, meta, '', '');
          }
        }
        this.fileService.saveDraft(todoId, message.content || '');
        vscode.window.showInformationMessage('[Nulab] ドラフトを保存しました');
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
        await this.render(webviewPanel, todoId, cachedSlackBefore, cachedSlackAfter);
        vscode.window.showInformationMessage('[Nulab] ドラフトを破棄しました');
      }
    });
  }

  private async render(
    panel: vscode.WebviewPanel,
    todoId: string,
    slackContextBefore: SlackMessage[] = [],
    slackContextAfter: SlackMessage[] = []
  ): Promise<void> {
    const todo = this.todoProvider.findTodoById(todoId);
    if (!todo) {
      panel.webview.html = '<html><body><p>TODO が見つかりません</p></body></html>';
      return;
    }

    const draft = this.fileService.getDraftInfo(todoId);
    const fullContextMarkdown = this.fileService.getContextSection(todoId);

    // Convert markdown to HTML for webview display
    const fullContext = fullContextMarkdown
      ? MarkdownRenderer.getInstance().renderMarkdown(fullContextMarkdown)
      : undefined;

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

  private buildInitialContext(todoId: string): string {
    const todo = this.todoProvider.findTodoById(todoId);
    if (!todo) {
      return '';
    }
    const sessionFilePath = this.fileService.getSessionFilePath(todoId);
    const parts = [
      'あなたはドキュメントの作成・校正・レビューを行うアシスタントです。',
      '以下のTODOへの対応を支援してください。',
      '回答のドラフトは次のファイルの DRAFT セクションに書き込んでください:',
      sessionFilePath,
      '',
      '## TODO',
      todo.text,
    ];
    try {
      const content = fs.readFileSync(sessionFilePath, 'utf-8');
      const m = content.match(/<!-- CONTEXT[^>]*-->([\s\S]*?)<!-- \/CONTEXT -->/);
      if (m && m[1].trim()) {
        parts.push('', '## コンテキスト', m[1].trim());
      }
    } catch {
      // no session file
    }
    return parts.join('\n');
  }

  private startChatSession(panel: vscode.WebviewPanel, todoId: string): void {
    this.log(`startChatSession: todoId=${todoId}`);
    // Ensure session file exists
    if (!this.fileService.hasSession(todoId)) {
      const todo = this.todoProvider.findTodoById(todoId);
      if (todo) {
        this.todoPersistence.createSessionFromTodo(todo);
      }
    }

    this.todoProvider.setStatus(todoId, 'in_progress');
    this.sessionCodeLensProvider.refresh();

    const sessionFilePath = this.fileService.getSessionFilePath(todoId);
    const todo = this.todoProvider.findTodoById(todoId);
    if (!todo) {
      this.log(`startChatSession: todo not found for id=${todoId}`);
      return;
    }

    let context = '';
    try {
      const content = fs.readFileSync(sessionFilePath, 'utf-8');
      const m = content.match(/<!-- CONTEXT[^>]*-->([\s\S]*?)<!-- \/CONTEXT -->/);
      context = m ? m[1].trim() : '';
    } catch {
      // no context
    }

    const initialMessage = [
      `以下のTODOに対応してください。`,
      ``,
      `## TODO`,
      todo.text,
      ...(context ? [``, `## コンテキスト`, context] : []),
      ``,
      `回答のドラフトは以下のファイルの DRAFT セクションに書き込んでください:`,
      sessionFilePath,
    ].join('\n');

    // Assign a new session ID for this TODO chat
    const sessionId = randomUUID();
    this.claudeSessionIds.set(todoId, sessionId);
    this.log(`startChatSession: sessionId=${sessionId}, launching first turn`);

    this.runClaudeTurn(panel, todoId, initialMessage, true);
  }

  private runClaudeTurn(
    panel: vscode.WebviewPanel,
    todoId: string,
    userMessage: string,
    isFirst: boolean,
    model?: string
  ): void {
    // Kill any running process
    const existing = this.claudeProcesses.get(todoId);
    if (existing) {
      existing.kill();
      this.claudeProcesses.delete(todoId);
    }

    const sessionId = this.claudeSessionIds.get(todoId);
    if (!sessionId) {
      this.log(`runClaudeTurn: no sessionId for todoId=${todoId}`);
      return;
    }

    this.log(`runClaudeTurn: isFirst=${isFirst}, sessionId=${sessionId}`);
    const args = [
      '--print',
      '--verbose',
      '--output-format',
      'stream-json',
      '--include-partial-messages',
    ];
    if (isFirst) {
      const systemPrompt = this.buildInitialContext(todoId);
      if (systemPrompt) {
        args.push('--system-prompt', systemPrompt);
      }
    }
    if (model) {
      args.push('--model', model);
    }
    args.push(isFirst ? '--session-id' : '--resume', sessionId, userMessage);

    const env = { ...process.env };
    // Ensure Homebrew path is included when VSCode is launched from GUI
    if (!env.PATH?.includes('/opt/homebrew/bin')) {
      env.PATH = `/opt/homebrew/bin:/usr/local/bin:${env.PATH ?? ''}`;
    }
    this.log(`runClaudeTurn: spawn claude ${args.slice(0, -1).join(' ')} [message omitted]`);
    const proc = spawn('claude', args, {
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      env,
    });
    this.log(`runClaudeTurn: pid=${proc.pid}, stdout=${!!proc.stdout}, stderr=${!!proc.stderr}`);
    proc.stdin?.end();
    this.claudeProcesses.set(todoId, proc);

    proc.on('error', (err) => {
      this.log(`runClaudeTurn: spawn error: ${err.message}`);
      panel.webview.postMessage({ command: 'chatError', text: `起動エラー: ${err.message}` });
    });

    panel.webview.postMessage({ command: 'chatTurnStart' });

    let buffer = '';
    proc.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        this.log(`stdout line: ${line.substring(0, 120)}`);
        try {
          const obj = JSON.parse(line);
          this.log(`stdout type=${obj.type}`);
          if (obj.type === 'assistant' && obj.message?.content) {
            let text = '';
            for (const block of obj.message.content) {
              if (block.type === 'text') {
                text += block.text;
              }
            }
            if (text) {
              panel.webview.postMessage({ command: 'chatChunk', text });
            }
          }
        } catch {
          this.log(`stdout non-JSON: ${line.substring(0, 80)}`);
        }
      }
    });

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim();
      if (text) {
        this.log(`runClaudeTurn: stderr: ${text}`);
        panel.webview.postMessage({ command: 'chatError', text });
      }
    });

    proc.on('close', (code) => {
      this.log(`runClaudeTurn: process closed, code=${code}`);
      this.claudeProcesses.delete(todoId);
      panel.webview.postMessage({ command: 'chatDone' });

      // Re-read draft after Claude finishes
      const draft = this.fileService.getDraftInfo(todoId);
      if (draft) {
        panel.webview.postMessage({ command: 'updateDraft', draft: draft.content });
      }
    });
  }
}
