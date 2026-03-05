import * as vscode from 'vscode';
import { WorkspaceTodoItem, SlackMessage } from '../types/workspace';
import { WebviewHelper } from './common';

export interface DraftInfo {
  content: string;
  action: string;
  status: string;
}

export class TodoWebview {
  static getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    todo: WorkspaceTodoItem,
    baseUrl?: string,
    slackContextBefore: SlackMessage[] = [],
    slackContextAfter: SlackMessage[] = [],
    draft?: DraftInfo | null,
    fullContext?: string
  ): string {
    const nonce = WebviewHelper.getNonce();

    // Get URIs for bundled resources
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', 'webviews', 'todoView.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'webview-common.css')
    );

    // Prepare initial state for React
    const initialState = {
      todo,
      baseUrl,
      slackContextBefore,
      slackContextAfter,
      draft,
      fullContext,
    };

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${
    webview.cspSource
  } 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TODO</title>
  <link href="${styleUri}" rel="stylesheet">
  <style nonce="${nonce}">
    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      overflow: hidden;
    }
    #reactRoot {
      width: 100%;
      height: 100%;
    }
  </style>
</head>
<body>
  <div id="reactRoot"></div>
  <script nonce="${nonce}">
    window.__INITIAL_STATE__ = ${JSON.stringify(initialState).replace(/</g, '\\u003c')};
  </script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
