import * as vscode from 'vscode';

/**
 * Common webview utilities and helpers
 */
export class WebviewHelper {
  /**
   * Generate a secure nonce for CSP
   */
  static getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  /**
   * Escape HTML characters to prevent XSS
   */
  static escapeHtml(text: string): string {
    if (!text) {
      return '';
    }
    const map: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, function (m) {
      return map[m];
    });
  }

  /**
   * Format file size in human readable format
   */
  static formatFileSize(bytes: number): string {
    if (!bytes) {
      return 'Unknown';
    }
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) {
      return '0 Bytes';
    }
    const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)).toString());
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Get common CSS style URIs for webview
   */
  static getStyleUris(webview: vscode.Webview, extensionUri: vscode.Uri) {
    return {
      styleResetUri: webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'reset.css')
      ),
      styleVSCodeUri: webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'vscode.css')
      ),
      styleMainUri: webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'main.css')
      ),
      styleMarkdownUri: webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'markdown.css')
      ),
      styleWebviewCommonUri: webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'webview-common.css')
      )
    };
  }

  /**
   * Generate common HTML head section
   */
  static getHtmlHead(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    title: string,
    additionalStyles?: string,
    nonce?: string
  ): string {
    const styles = this.getStyleUris(webview, extensionUri);
    const styleNonce = nonce || this.getNonce();

    // Wrap additional styles with nonce if provided
    const wrappedStyles = additionalStyles ?
      `<style nonce="${styleNonce}">${additionalStyles.replace(/<\/?style[^>]*>/g, '')}</style>` :
      '';

    return `
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${styleNonce}'; script-src 'nonce-${styleNonce}'; font-src ${webview.cspSource}; img-src https: data: ${webview.cspSource};">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styles.styleResetUri}" rel="stylesheet">
        <link href="${styles.styleVSCodeUri}" rel="stylesheet">
        <link href="${styles.styleWebviewCommonUri}" rel="stylesheet">
        <link href="${styles.styleMarkdownUri}" rel="stylesheet">
        <link href="${styles.styleMainUri}" rel="stylesheet">
        <title>${this.escapeHtml(title)}</title>
        <style nonce="${styleNonce}">
          /* Simple icon replacements using Unicode and symbols */
          .icon-refresh::before { content: "🔄"; }
          .icon-link-external::before { content: "🔗"; }
          .icon-info::before { content: "ℹ️"; }
          .icon-issue::before { content: "🐛"; }
          .icon-person::before { content: "👤"; }
          
          /* Alternative text-based icons */
          .text-icon-refresh::before { content: "↻"; }
          .text-icon-link::before { content: "⧉"; }
          .text-icon-info::before { content: "i"; border: 1px solid; border-radius: 50%; width: 1em; height: 1em; display: inline-flex; align-items: center; justify-content: center; font-size: 0.8em; font-weight: bold; }
          .text-icon-issue::before { content: "#"; }
          .text-icon-person::before { content: "@"; }
        </style>
        ${wrappedStyles}
      </head>
    `;
  }

  /**
   * Generate error webview content
   */
  static getErrorWebviewContent(errorMessage: string): string {
    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Error</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 20px;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
          }
          .error {
            color: var(--vscode-errorForeground);
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            padding: 15px;
            border-radius: 4px;
          }
        </style>
      </head>
      <body>
        <div class="error">
          <h2>Error</h2>
          <p>${this.escapeHtml(errorMessage)}</p>
        </div>
      </body>
      </html>`;
  }
}
