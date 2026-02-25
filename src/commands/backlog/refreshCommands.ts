import * as vscode from 'vscode';
import { ServiceContainer } from '../../container';

export function registerRefreshCommands(c: ServiceContainer): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('nulab.refreshProjects', () => {
      c.backlogTreeViewProvider.refresh();
      c.backlogProjectsWebviewProvider.refresh();
      c.backlogIssuesProvider.refresh();
      c.backlogWikiProvider.refresh();
      c.backlogDocumentsProvider.refresh();
    }),

    vscode.commands.registerCommand('nulab.refreshIssues', () => {
      c.backlogIssuesProvider.refresh();
    }),

    vscode.commands.registerCommand('nulab.refreshWiki', () => {
      c.backlogWikiProvider.refresh();
    }),

    vscode.commands.registerCommand('nulab.refreshDocuments', async () => {
      c.backlogDocumentsProvider.refresh();
    }),

    vscode.commands.registerCommand('nulab.filterModifiedDocuments', () => {
      const active = c.backlogDocumentsProvider.toggleFilterModified();
      vscode.window.showInformationMessage(
        active ? '[Nulab] Documents: 変更ありのみ表示' : '[Nulab] Documents: フィルタ解除'
      );
    }),
  ];
}
