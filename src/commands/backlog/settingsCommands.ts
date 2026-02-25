import * as vscode from 'vscode';
import { ServiceContainer } from '../../container';

export function registerSettingsCommands(c: ServiceContainer): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('nulab.openSettings', () => {
      vscode.commands.executeCommand('workbench.action.openSettings', 'nulab');
    }),

    vscode.commands.registerCommand('nulab.setApiKey', async () => {
      const apiKey = await vscode.window.showInputBox({
        prompt: 'Enter your Backlog API Key',
        password: true,
        placeHolder: 'Your API Key will be stored securely',
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return 'API Key cannot be empty';
          }
          return null;
        },
      });

      if (apiKey) {
        await c.backlogConfig.setApiKey(apiKey.trim());
        await c.backlogApi.reinitialize();
        c.backlogTreeViewProvider.refresh();
        vscode.window.showInformationMessage(
          '[Nulab] API Key has been set successfully and stored securely.'
        );
      }
    }),
  ];
}
