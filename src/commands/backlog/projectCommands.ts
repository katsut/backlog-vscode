import * as vscode from 'vscode';
import { ProjectTreeItem } from '../../providers/treeViewProvider';
import { ServiceContainer } from '../../container';

export function registerProjectCommands(c: ServiceContainer): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('nulab.focusProject', async (projectId: number) => {
      try {
        await c.backlogIssuesProvider.setProject(projectId);
        await c.backlogWikiProvider.setProject(projectId);
        await c.backlogDocumentsProvider.setProject(projectId);
        await vscode.commands.executeCommand('setContext', 'nulabProjectFocused', true);
        await c.backlogTreeViewProvider.focusProject(projectId);
        await vscode.commands.executeCommand('workbench.view.extension.backlogContainer');
      } catch (error) {
        console.error('Error in focusProject command:', error);
        vscode.window.showErrorMessage(`[Nulab] Failed to focus project: ${error}`);
      }
    }),

    vscode.commands.registerCommand('nulab.unfocusProject', () => {
      c.backlogIssuesProvider.clearProject();
      c.backlogWikiProvider.clearProject();
      c.backlogDocumentsProvider.clearProject();
      vscode.commands.executeCommand('setContext', 'nulabProjectFocused', false);
      c.backlogTreeViewProvider.unfocusProject();
    }),

    vscode.commands.registerCommand('nulab.openProjectByKey', async () => {
      const projectKey = await vscode.window.showInputBox({
        prompt: 'Enter Backlog project key to open',
        placeHolder: 'e.g., PROJ, DEV, TEST',
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Project key cannot be empty';
          }
          if (!/^[A-Z][A-Z0-9_]*$/i.test(value.trim())) {
            return 'Project key should contain only letters, numbers, and underscores';
          }
          return null;
        },
      });

      if (projectKey) {
        try {
          const projects = await c.backlogApi.getProjects();
          const project = projects.find(
            (p) => p.projectKey.toLowerCase() === projectKey.trim().toLowerCase()
          );

          if (project) {
            await vscode.commands.executeCommand('nulab.focusProject', project.id);
          } else {
            vscode.window.showErrorMessage(`[Nulab] Project not found: ${projectKey}`);
          }
        } catch (error) {
          console.error('Error in openProjectByKey:', error);
          vscode.window.showErrorMessage(`[Nulab] Failed to open project: ${error}`);
        }
      }
    }),

    vscode.commands.registerCommand('nulab.toggleFavorite', (item: ProjectTreeItem) => {
      if (item?.project?.projectKey) {
        c.backlogTreeViewProvider.toggleFavorite(item.project.projectKey);
      }
    }),
  ];
}
