import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TodoTreeItem } from '../../providers/todoTreeViewProvider';
import { ServiceContainer } from '../../container';

/** Track Claude terminals per TODO ID so we can reuse them */
const claudeTerminals = new Map<string, vscode.Terminal>();

export function registerSessionCommands(c: ServiceContainer): vscode.Disposable[] {
  // Clean up map when terminals are closed
  const terminalCloseListener = vscode.window.onDidCloseTerminal((t) => {
    for (const [id, term] of claudeTerminals) {
      if (term === t) {
        claudeTerminals.delete(id);
        break;
      }
    }
  });

  return [
    terminalCloseListener,

    vscode.commands.registerCommand(
      'workspace.startClaudeSession',
      async (itemOrTodoId: TodoTreeItem | string) => {
        let resolved: import('../../types/workspace').WorkspaceTodoItem | undefined;
        if (itemOrTodoId instanceof TodoTreeItem) {
          resolved = itemOrTodoId.todo;
        } else if (typeof itemOrTodoId === 'string') {
          resolved = c.todoProvider.findTodoById(itemOrTodoId);
        }
        if (!resolved) {
          return;
        }
        const todo = resolved;

        try {
          // Ensure session file exists
          if (!c.sessionFileService.hasSession(todo.id)) {
            c.todoPersistence.createSessionFromTodo(todo);
          }

          c.todoProvider.setStatus(todo.id, 'in_progress');
          c.sessionCodeLensProvider.refresh();

          const sessionFilePath = c.sessionFileService.getSessionFilePath(todo.id);

          // Reuse existing terminal if still alive
          const existing = claudeTerminals.get(todo.id);
          if (existing) {
            existing.show();
            return;
          }

          // Build initial prompt from session file context
          const sessionContent = fs.readFileSync(sessionFilePath, 'utf-8');
          const contextMatch = sessionContent.match(
            /<!-- CONTEXT[^>]*-->([\s\S]*?)<!-- \/CONTEXT -->/
          );
          const context = contextMatch ? contextMatch[1].trim() : '';
          const shortTitle = todo.text.substring(0, 40);

          const initialPrompt = [
            `以下のTODOに対応してください。`,
            ``,
            `## TODO`,
            todo.text,
            ...(context ? [``, `## コンテキスト`, context] : []),
            ``,
            `回答のドラフトは以下のファイルの DRAFT セクションに書き込んでください:`,
            sessionFilePath,
          ].join('\n');

          // Create terminal and run claude with initial prompt
          const terminal = vscode.window.createTerminal({
            name: `Claude: ${shortTitle}`,
            iconPath: new vscode.ThemeIcon('sparkle'),
          });
          claudeTerminals.set(todo.id, terminal);
          terminal.show();

          // Escape single quotes for shell
          const escaped = initialPrompt.replace(/'/g, "'\\''");
          terminal.sendText(`claude '${escaped}'`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`[Nulab] セッション開始に失敗: ${msg}`);
        }
      }
    ),

    vscode.commands.registerCommand('nulab.postSessionReply', async (filePath: string) => {
      const parsed = c.sessionFileService.parseSession(filePath);
      if (!parsed) {
        vscode.window.showErrorMessage('[Nulab] セッションファイルを読み取れません');
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
          await c.sessionReply.postBacklogReply(filePath);
        } else if (parsed.meta.action === 'slack-reply') {
          await c.sessionReply.postSlackReply(filePath);
        }

        if (parsed.meta.id) {
          c.todoProvider.markReplied(parsed.meta.id);
        }

        c.sessionCodeLensProvider.refresh();
        vscode.window.showInformationMessage(`[Nulab] ${label}しました`);

        const editors = vscode.window.visibleTextEditors;
        const draftEditor = editors.find((e) => e.document.uri.fsPath === filePath);
        if (draftEditor) {
          await vscode.window.showTextDocument(draftEditor.document);
          await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`[Nulab] 投稿に失敗: ${msg}`);
      }
    }),

    vscode.commands.registerCommand('nulab.discardSession', async (filePath: string) => {
      const confirm = await vscode.window.showWarningMessage(
        'ドラフトを破棄しますか？',
        { modal: true },
        '破棄'
      );
      if (confirm !== '破棄') {
        return;
      }

      try {
        const editors = vscode.window.visibleTextEditors;
        const draftEditor = editors.find((e) => e.document.uri.fsPath === filePath);
        if (draftEditor) {
          await vscode.window.showTextDocument(draftEditor.document);
          await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
        }
        const basename = path.basename(filePath, '.todomd');
        const todoId = basename.replace(/^todo-/, '');
        c.sessionFileService.clearDraft(todoId);
        vscode.window.showInformationMessage('[Nulab] ドラフトを破棄しました');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`[Nulab] 破棄に失敗: ${msg}`);
      }
    }),
  ];
}
