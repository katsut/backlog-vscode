import * as vscode from 'vscode';
import { NotificationTreeItem } from '../../providers/notificationsTreeViewProvider';
import { NOTIFICATION_REASONS, TodoContext } from '../../types/workspace';
import { ServiceContainer } from '../../container';

export function registerNotificationCommands(c: ServiceContainer): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('workspace.refreshMyTasks', () => {
      c.myTasksProvider.refresh();
    }),

    vscode.commands.registerCommand('workspace.refreshNotifications', () => {
      c.notificationsProvider.refresh();
    }),

    vscode.commands.registerCommand(
      'workspace.markNotificationRead',
      (item: NotificationTreeItem) => {
        if (item instanceof NotificationTreeItem) {
          c.notificationsProvider.markAsRead(item.notification.id);
        }
      }
    ),

    vscode.commands.registerCommand('workspace.markAllNotificationsRead', () => {
      c.notificationsProvider.markAllAsRead();
    }),

    vscode.commands.registerCommand('workspace.toggleNotificationFilter', () => {
      const active = c.notificationsProvider.toggleFilterUnread();
      vscode.window.showInformationMessage(
        active ? '[Nulab] Notifications: 未読のみ表示' : '[Nulab] Notifications: フィルタ解除'
      );
    }),

    vscode.commands.registerCommand(
      'workspace.notificationToTodo',
      async (item: NotificationTreeItem) => {
        if (!(item instanceof NotificationTreeItem)) {
          return;
        }
        const n = item.notification;
        const text = item.todoSummary || item.label?.toString() || '';
        const context: TodoContext = {
          source: 'backlog-notification',
          issueKey: n.issue?.issueKey,
          issueId: n.issue?.id,
          issueSummary: n.issue?.summary,
          notificationId: n.id,
          commentId: n.comment?.id,
          sender: n.sender?.name,
          senderId: n.sender?.id,
          senderUserId: n.sender?.userId,
          reason: NOTIFICATION_REASONS[n.reason] || `reason:${n.reason}`,
          comment: n.comment?.content,
        };
        const todo = c.todoProvider.addTodo(text, context);

        // Fetch full issue context from Backlog API
        if (n.issue?.issueKey) {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: `[Nulab] ${n.issue.issueKey} の課題情報を取得中...`,
            },
            async () => {
              try {
                await c.todoPersistence.startBacklogSession(todo);
              } catch (e) {
                c.log(`notificationToTodo: failed to fetch context: ${e}`);
              }
            }
          );
        }

        // Sync TODO state to notifications tree
        c.notificationsProvider.setTodoIssueKeys(c.todoProvider.getTodoIssueKeys());

        vscode.window.showInformationMessage('[Nulab] TODO に追加しました');
      }
    ),
  ];
}
