import * as vscode from 'vscode';
import { MeetingNotesWebview } from '../webviews/meetingNotesWebview';
import { GoogleCalendarEvent, GoogleDriveFile } from '../types/google';

/**
 * Custom editor for .gdoc files (Google Docs meeting notes).
 * The .gdoc file stores JSON metadata + HTML content.
 */
export class GdocEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'nulab.gdocEditor';

  constructor(private readonly extensionUri: vscode.Uri) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    const content = document.getText();
    const parsed = parseGdocFile(content);
    if (!parsed) {
      webviewPanel.webview.html = '<html><body><p>gdoc ファイルを認識できません</p></body></html>';
      return;
    }

    webviewPanel.webview.html = MeetingNotesWebview.getWebviewContent(
      webviewPanel.webview,
      this.extensionUri,
      parsed.event,
      parsed.file,
      parsed.html
    );

    webviewPanel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command === 'openExternal' && msg.url) {
        vscode.env.openExternal(vscode.Uri.parse(msg.url));
      } else if (msg.command === 'copyToClipboard' && msg.content) {
        await vscode.env.clipboard.writeText(msg.content);
        vscode.window.showInformationMessage('コピーしました');
      } else if (msg.command === 'addToTodo') {
        vscode.commands.executeCommand('nulab.google.addToTodoFromDoc', parsed);
      }
    });
  }
}

interface GdocParsed {
  event: GoogleCalendarEvent;
  file: GoogleDriveFile;
  html: string;
}

function parseGdocFile(content: string): GdocParsed | null {
  // Format: first line is JSON metadata, rest is HTML
  const newlineIdx = content.indexOf('\n');
  if (newlineIdx === -1) {
    return null;
  }
  try {
    const meta = JSON.parse(content.substring(0, newlineIdx));
    const html = content.substring(newlineIdx + 1);
    return {
      event: meta.event as GoogleCalendarEvent,
      file: meta.file as GoogleDriveFile,
      html,
    };
  } catch {
    return null;
  }
}
