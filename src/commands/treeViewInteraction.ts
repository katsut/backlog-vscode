import * as vscode from 'vscode';

/**
 * Registers the click-guard and enter-key handlers for all tree views.
 * The click guard ensures that the first click selects an item (highlight),
 * and only the second click (on an already-selected item) executes the command.
 */
export function registerTreeViewInteraction(
  allTreeViews: vscode.TreeView<any>[],
  treeViewHandlers: { view: vscode.TreeView<any>; handler: (item: any) => void }[]
): vscode.Disposable[] {
  let clickGuardActive = false;

  for (const tv of allTreeViews) {
    tv.onDidChangeSelection(() => {
      clickGuardActive = true;
      setTimeout(() => {
        clickGuardActive = false;
      }, 100);
    });
  }

  return [
    vscode.commands.registerCommand(
      'nulab.treeItemClicked',
      (targetCommand: string, ...args: any[]) => {
        if (!clickGuardActive) {
          vscode.commands.executeCommand(targetCommand, ...args);
        }
      }
    ),

    vscode.commands.registerCommand('nulab.openSelectedTreeItem', () => {
      for (const { view, handler } of treeViewHandlers) {
        const selected = view.selection[0];
        if (selected && view.visible) {
          handler(selected);
          return;
        }
      }
    }),
  ];
}
