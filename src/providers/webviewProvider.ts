import * as vscode from 'vscode';
import { BacklogApiService } from '../services/backlogApi';

export class BacklogWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'backlogIssueDetail';

  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly backlogApi: BacklogApiService
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      // Allow scripts in the webview
      enableScripts: true,

      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((data) => {
      switch (data.type) {
        case 'openInBrowser': {
          if (data.url) {
            vscode.env.openExternal(vscode.Uri.parse(data.url));
          }
          break;
        }
      }
    });
  }

  public async showIssueDetail(issue: any) {
    if (this._view) {
      this._view.show?.(true); // `show` is not implemented in 1.49 but is for 1.50 insiders
      try {
        // Get additional issue details and comments
        const [detailedIssue, comments] = await Promise.all([
          this.backlogApi.getIssue(issue.id),
          this.backlogApi.getIssueComments(issue.id),
        ]);

        this._view.webview.postMessage({
          type: 'showIssue',
          issue: detailedIssue,
          comments: comments,
        });
      } catch (error) {
        console.error('Error loading issue details:', error);
        vscode.window.showErrorMessage(`Failed to load issue details: ${error}`);
      }
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    // Get the local path to main script run in the webview, then convert it to a uri we can use in the webview.
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js')
    );

    // Do the same for the stylesheet.
    const styleResetUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css')
    );
    const styleVSCodeUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css')
    );
    const styleMainUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css')
    );

    // Use a nonce to only allow specific scripts to be run
    const nonce = getNonce();

    return `<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">
				<!--
					Use a content security policy to only allow loading images from https or from our extension directory,
					and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}';">
				<meta name="viewport" content="width=device-width, initial-scale=1.0">
				<link href="${styleResetUri}" rel="stylesheet">
				<link href="${styleVSCodeUri}" rel="stylesheet">
				<link href="${styleMainUri}" rel="stylesheet">
				<title>Backlog Issue Detail</title>
			</head>
			<body>
				<div id="loading" class="loading">
					<p>Select an issue to view details...</p>
				</div>
				<div id="issue-container" style="display: none;">
					<div class="issue-header">
						<h1 id="issue-title"></h1>
						<div class="issue-meta">
							<span id="issue-key" class="issue-key"></span>
							<span id="issue-status" class="status-badge"></span>
							<span id="issue-priority" class="priority-badge"></span>
						</div>
					</div>
					
					<div class="issue-details">
						<div class="issue-field">
							<label>Assignee:</label>
							<span id="issue-assignee"></span>
						</div>
						<div class="issue-field">
							<label>Created:</label>
							<span id="issue-created"></span>
						</div>
						<div class="issue-field">
							<label>Updated:</label>
							<span id="issue-updated"></span>
						</div>
						<div class="issue-field">
							<label>Due Date:</label>
							<span id="issue-due-date"></span>
						</div>
					</div>
					
					<div class="issue-description">
						<h3>Description</h3>
						<div id="issue-description-content"></div>
					</div>
					
					<div class="issue-comments">
						<h3>Comments</h3>
						<div id="comments-container"></div>
					</div>
					
					<div class="issue-actions">
						<button id="open-in-browser" type="button">Open in Backlog</button>
					</div>
				</div>
				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
