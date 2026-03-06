import * as vscode from 'vscode';
import { WebviewHelper } from './common';

interface DocumentData {
  title: string;
  backlogId: string;
  project: string;
  syncedAt: string;
  updatedAt: string;
  filePath: string;
  backlogDomain?: string;
}

export class DocumentEditorWebview {
  static getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    docData: DocumentData,
    content?: string,
    _initialPreviewHtml?: string
  ): string {
    const nonce = WebviewHelper.getNonce();

    // Get URIs for bundled resources
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', 'webviews', 'documentEditor.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'webview-common.css')
    );

    const backlogUrl =
      docData.backlogId && docData.project && docData.backlogDomain
        ? `https://${docData.backlogDomain}/document/${docData.project}/${docData.backlogId}`
        : undefined;

    // Prepare initial state for React
    const initialState = {
      title: docData.title,
      content: content || '', // Use provided content or empty string
      backlogUrl,
    };

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${
    webview.cspSource
  } 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${docData.title}</title>
  <link href="${styleUri}" rel="stylesheet">
  <style nonce="${nonce}">
    body {
      margin: 0;
      padding: 0;
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    #reactRoot {
      flex: 1;
      display: flex;
      overflow: hidden;
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
