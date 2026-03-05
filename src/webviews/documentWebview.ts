import * as vscode from 'vscode';
import { WebviewHelper } from './common';
import { Entity } from 'backlog-js';
import { BacklogApiService } from '../services/backlogApi';
import { DocumentWebview as LegacyDocumentWebview } from './legacy/documentWebview';

export class DocumentWebview {
  /**
   * Generate React-based webview HTML from document entity
   */
  static async getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    document: Entity.Document.Document,
    baseUrl: string | undefined,
    backlogApi: BacklogApiService,
    projectKey?: string
  ): Promise<string> {
    const title = document.title || 'Unnamed Document';

    // Convert document content using legacy converter
    const htmlContent = await LegacyDocumentWebview.convertDocumentContent(
      document,
      baseUrl,
      backlogApi
    );

    // Build Backlog URL
    const fullBaseUrl = baseUrl
      ? baseUrl.startsWith('http')
        ? baseUrl
        : `https://${baseUrl}`
      : null;
    const backlogUrl =
      fullBaseUrl && document.id && projectKey
        ? `${fullBaseUrl}/document/${projectKey}/${document.id}`
        : undefined;

    return this.generateReactHtml(webview, extensionUri, title, htmlContent, backlogUrl);
  }

  /**
   * Generate simple React-based webview HTML shell
   */
  private static generateReactHtml(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    title: string,
    htmlContent: string,
    backlogUrl?: string
  ): string {
    const nonce = WebviewHelper.getNonce();

    // Get URIs for bundled resources
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'dist', 'webviews', 'documentView.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'webview-common.css')
    );
    const markdownStyleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extensionUri, 'media', 'markdown.css')
    );

    // Prepare initial state for React
    const initialState = {
      title,
      content: htmlContent,
      backlogUrl,
    };

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${
    webview.cspSource
  } 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https: data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <link href="${styleUri}" rel="stylesheet">
  <link href="${markdownStyleUri}" rel="stylesheet">
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
