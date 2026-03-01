import * as vscode from 'vscode';
import { TodoTreeItem } from '../../providers/todoTreeViewProvider';
import { MyTaskTreeItem } from '../../providers/myTasksTreeViewProvider';
import { ServiceContainer } from '../../container';

export function registerTodoCommands(
  c: ServiceContainer,
  todosTreeView: vscode.TreeView<any>
): vscode.Disposable[] {
  let lastFocusedTodoItem: TodoTreeItem | undefined;

  todosTreeView.onDidChangeSelection((e) => {
    const item = e.selection[0];
    if (item instanceof TodoTreeItem) {
      lastFocusedTodoItem = item;
    }
  });

  return [
    vscode.commands.registerCommand('workspace.addTodo', async () => {
      const text = await vscode.window.showInputBox({
        prompt: 'TODO を入力',
        placeHolder: 'タスクの内容',
      });
      if (text) {
        const newTodo = c.todoProvider.addTodo(text);
        vscode.commands.executeCommand('workspace.openTodoDetail', newTodo.id);
      }
    }),

    vscode.commands.registerCommand('workspace.toggleTodo', (id: string) => {
      c.todoProvider.toggleTodo(id);
    }),

    vscode.commands.registerCommand('workspace.editTodo', async (item: TodoTreeItem) => {
      if (!(item instanceof TodoTreeItem)) {
        return;
      }
      const newText = await vscode.window.showInputBox({
        prompt: 'TODO を編集',
        value: item.todo.text,
      });
      if (newText !== undefined) {
        c.todoProvider.editTodo(item.todo.id, newText);
      }
    }),

    vscode.commands.registerCommand('workspace.deleteTodo', async (item?: TodoTreeItem) => {
      if (!item || !(item instanceof TodoTreeItem)) {
        const selected = todosTreeView.selection[0];
        if (selected instanceof TodoTreeItem) {
          item = selected;
        } else if (lastFocusedTodoItem) {
          item = lastFocusedTodoItem;
        } else {
          return;
        }
      }
      const label =
        item.todo.text.length > 40 ? item.todo.text.substring(0, 40) + '...' : item.todo.text;
      const answer = await vscode.window.showWarningMessage(
        `TODO「${label}」を削除しますか？`,
        { modal: true },
        'Delete'
      );
      if (answer === 'Delete') {
        c.todoProvider.deleteTodo(item.todo.id);
        lastFocusedTodoItem = undefined;
      }
    }),

    vscode.commands.registerCommand('workspace.moveTodoUp', (item: TodoTreeItem) => {
      if (!(item instanceof TodoTreeItem)) {
        return;
      }
      c.todoProvider.reorder(item.todo.id, 'up');
    }),

    vscode.commands.registerCommand('workspace.moveTodoDown', (item: TodoTreeItem) => {
      if (!(item instanceof TodoTreeItem)) {
        return;
      }
      c.todoProvider.reorder(item.todo.id, 'down');
    }),

    vscode.commands.registerCommand('workspace.clearCompletedTodos', () => {
      c.todoProvider.clearCompleted();
    }),

    vscode.commands.registerCommand('workspace.cycleTodoStatus', (id: string) => {
      c.todoProvider.cycleStatus(id);
    }),

    vscode.commands.registerCommand('workspace.openTodoSource', async (todoId: string) => {
      const todo = c.todoProvider.findTodoById(todoId);
      if (!todo) {
        return;
      }
      vscode.commands.executeCommand('workspace.openTodoDetail', todoId);
    }),

    vscode.commands.registerCommand(
      'workspace.openTodoDetail',
      async (todoIdOrItem: string | TodoTreeItem) => {
        const todoId = typeof todoIdOrItem === 'string' ? todoIdOrItem : todoIdOrItem?.todo?.id;
        if (!todoId) {
          return;
        }
        const fileUri = vscode.Uri.file(c.sessionFileService.getSessionFilePath(todoId));
        await vscode.commands.executeCommand('vscode.openWith', fileUri, 'nulab.todoEditor');
      }
    ),

    vscode.commands.registerCommand('workspace.setTodoStatus', async (item: TodoTreeItem) => {
      if (!(item instanceof TodoTreeItem)) {
        return;
      }
      const pick = await vscode.window.showQuickPick(
        [
          { label: '○ 未着手', status: 'open' as const },
          { label: '◉ 進行中', status: 'in_progress' as const },
          { label: '◷ 待ち', status: 'waiting' as const },
          { label: '✓ 完了', status: 'done' as const },
        ],
        { placeHolder: 'ステータスを選択' }
      );
      if (pick) {
        c.todoProvider.setStatus(item.todo.id, pick.status);
      }
    }),

    vscode.commands.registerCommand('workspace.editTodoNotes', async (item: TodoTreeItem) => {
      if (!(item instanceof TodoTreeItem)) {
        return;
      }
      const notes = await vscode.window.showInputBox({
        prompt: 'Notes を入力',
        placeHolder: 'メモ',
        value: item.todo.notes || '',
      });
      if (notes !== undefined) {
        c.todoProvider.editNotes(item.todo.id, notes);
      }
    }),

    vscode.commands.registerCommand('workspace.replyToTodoIssue', async (item: TodoTreeItem) => {
      if (!(item instanceof TodoTreeItem)) {
        return;
      }
      const ctx = item.todo.context;
      if (ctx?.source === 'backlog-notification' && ctx.issueKey) {
        const baseUrl = c.backlogConfig.getBaseUrl();
        if (baseUrl) {
          const url = `${baseUrl}/view/${ctx.issueKey}#comment`;
          await vscode.env.openExternal(vscode.Uri.parse(url));
          c.todoProvider.markReplied(item.todo.id);
        }
      }
    }),

    vscode.commands.registerCommand('workspace.addTodoFromMyTask', async (item: MyTaskTreeItem) => {
      if (!(item instanceof MyTaskTreeItem)) {
        return;
      }
      const issue = item.issue;
      const text = `[${issue.issueKey}] ${issue.summary}`;

      // Dedup: skip if non-done TODO already exists for this issue
      const existing = c.todoProvider
        .getTodos()
        .find(
          (t) =>
            t.status !== 'done' &&
            t.context?.source === 'backlog-notification' &&
            t.context?.issueKey === issue.issueKey
        );
      if (existing) {
        vscode.window.showInformationMessage(`[Nulab] ${issue.issueKey} の TODO は既にあります。`);
        vscode.commands.executeCommand('workspace.openTodoDetail', existing.id);
        return;
      }

      const todo = c.todoProvider.addTodo(text, {
        source: 'backlog-notification',
        issueKey: issue.issueKey,
        issueId: issue.id,
        issueSummary: issue.summary,
      });

      // Fetch full issue context asynchronously
      c.todoPersistence.startBacklogSession(todo).catch((err) => {
        c.log(`Failed to fetch issue context for ${issue.issueKey}: ${err}`);
      });

      vscode.window.showInformationMessage(`[Nulab] TODO に追加しました: ${issue.issueKey}`);
      vscode.commands.executeCommand('workspace.openTodoDetail', todo.id);
    }),

    vscode.commands.registerCommand('workspace.replyToTodoSlack', async (item: TodoTreeItem) => {
      if (!(item instanceof TodoTreeItem)) {
        return;
      }
      const ctx = item.todo.context;
      if (
        (ctx?.source === 'slack-mention' || ctx?.source === 'slack-search') &&
        ctx?.slackChannel
      ) {
        const ts = ctx.slackThreadTs || ctx.slackMessageTs || '';
        const sender = ctx.slackUserName || 'Thread';
        vscode.commands.executeCommand(
          'workspace.openSlackThread',
          ctx.slackChannel,
          ts,
          `Thread: ${sender}`
        );
      }
    }),
  ];
}
