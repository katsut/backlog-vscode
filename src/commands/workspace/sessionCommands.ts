import * as vscode from 'vscode';
import * as path from 'path';
import { TodoTreeItem } from '../../providers/todoTreeViewProvider';
import { ServiceContainer } from '../../container';

export function registerSessionCommands(c: ServiceContainer): vscode.Disposable[] {
  return [
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
          // Ensure session file exists (full context is fetched at TODO creation time)
          if (!c.sessionFileService.hasSession(todo.id)) {
            c.todoPersistence.createSessionFromTodo(todo);
          }

          c.sessionFileService.setActiveSession(todo.id);
          c.todoProvider.setStatus(todo.id, 'in_progress');
          c.sessionCodeLensProvider.refresh();

          const fileUri = vscode.Uri.file(c.sessionFileService.getSessionFilePath(todo.id));
          const doc = await vscode.workspace.openTextDocument(fileUri);
          await vscode.window.showTextDocument(doc, {
            preview: false,
            viewColumn: vscode.ViewColumn.One,
          });

          try {
            await vscode.commands.executeCommand('claude-vscode.editor.open');
          } catch {
            // Claude Code extension not installed
          }

          const tabGroup = vscode.window.tabGroups.all.find((g) =>
            g.tabs.some(
              (t) =>
                t.input instanceof vscode.TabInputText &&
                t.input.uri.toString() === fileUri.toString()
            )
          );
          if (tabGroup) {
            const tab = tabGroup.tabs.find(
              (t) =>
                t.input instanceof vscode.TabInputText &&
                t.input.uri.toString() === fileUri.toString()
            );
            if (tab) {
              await vscode.window.tabGroups.close(tab);
            }
          }
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
