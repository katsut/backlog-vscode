import * as vscode from 'vscode';
import { Entity } from 'backlog-js';
import { ServiceContainer } from '../../container';
import { WikiWebview } from '../../webviews/wikiWebview';
import { WebviewHelper } from '../../webviews/common';

export function registerOpenWikiCommand(c: ServiceContainer): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('nulab.openWiki', async (wiki: Entity.Wiki.WikiListItem) => {
      if (!wiki) {
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        'backlogWiki',
        `Wiki: ${wiki.name}`,
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [c.context.extensionUri],
        }
      );

      try {
        const wikiDetail = await c.backlogApi.getWiki(wiki.id);
        panel.webview.html = await WikiWebview.getWebviewContent(
          panel.webview,
          c.context.extensionUri,
          wikiDetail,
          c.backlogConfig.getBaseUrl(),
          c.backlogApi
        );

        panel.webview.onDidReceiveMessage(
          async (message) => {
            switch (message.command) {
              case 'openExternal':
                vscode.env.openExternal(vscode.Uri.parse(message.url));
                break;
              case 'refreshWiki':
                try {
                  const refreshedWiki = await c.backlogApi.getWiki(message.wikiId);
                  panel.webview.html = await WikiWebview.getWebviewContent(
                    panel.webview,
                    c.context.extensionUri,
                    refreshedWiki,
                    c.backlogConfig.getBaseUrl(),
                    c.backlogApi
                  );
                } catch (error) {
                  console.error('Error refreshing wiki:', error);
                  vscode.window.showErrorMessage(`[Nulab] Failed to refresh wiki: ${error}`);
                }
                break;
            }
          },
          undefined,
          c.context.subscriptions
        );
      } catch (error) {
        panel.webview.html = WebviewHelper.getErrorWebviewContent(`Failed to load wiki: ${error}`);
      }
    }),
  ];
}
