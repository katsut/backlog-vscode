import * as vscode from 'vscode';
import { SlackApiService } from '../services/slackApi';
import { SlackConfig } from '../config/slackConfig';

export class SlackPostWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'workspaceSlackPost';

  private _view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly slackApi: SlackApiService,
    private readonly slackConfig: SlackConfig
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'send':
          await this.handleSend(msg.channelId, msg.text);
          break;
        case 'requestChannels':
          this.sendChannels();
          break;
      }
    });

    this.sendChannels();
  }

  /** Refresh channel list from config */
  sendChannels(): void {
    const channels = this.slackConfig.getFavoriteChannels();
    this._view?.webview.postMessage({ type: 'channels', channels });
  }

  private async handleSend(channelId: string, text: string): Promise<void> {
    if (!channelId || !text) return;
    try {
      await this.slackApi.postMessage(channelId, text);
      const channels = this.slackConfig.getFavoriteChannels();
      const ch = channels.find((c) => c.id === channelId);
      this._view?.webview.postMessage({ type: 'sent' });
      vscode.window.showInformationMessage(`[Nulab] #${ch?.name || channelId} に投稿しました。`);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this._view?.webview.postMessage({ type: 'error', message: errMsg });
      vscode.window.showErrorMessage(`[Nulab] 投稿に失敗: ${errMsg}`);
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const styleResetUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'reset.css')
    );
    const styleVSCodeUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'vscode.css')
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleResetUri}" rel="stylesheet">
  <link href="${styleVSCodeUri}" rel="stylesheet">
  <style nonce="${nonce}">
    body { padding: 8px 12px; }
    .form-group { margin-bottom: 8px; }
    label { display: block; font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; }
    select, textarea {
      width: 100%; box-sizing: border-box;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, transparent);
      border-radius: 2px; padding: 4px 6px;
      font-family: inherit; font-size: 13px;
    }
    select:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); }
    textarea { resize: vertical; min-height: 60px; }
    .actions { display: flex; gap: 4px; }
    button {
      flex: 1; padding: 4px 10px; border: none; border-radius: 2px;
      cursor: pointer; font-family: inherit; font-size: 12px;
    }
    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    button.primary:disabled { opacity: 0.5; cursor: default; }
    .empty { color: var(--vscode-descriptionForeground); font-size: 12px; text-align: center; margin: 16px 0; }
    .empty a { color: var(--vscode-textLink-foreground); cursor: pointer; }
  </style>
</head>
<body>
  <div id="content">
    <div id="empty" class="empty" style="display:none;">
      お気に入りチャンネルを<br><a id="setupLink">登録してください</a>
    </div>
    <div id="form" style="display:none;">
      <div class="form-group">
        <label>Channel</label>
        <select id="channel"></select>
      </div>
      <div class="form-group">
        <label>Message</label>
        <textarea id="message" placeholder="メッセージを入力..." rows="3"></textarea>
      </div>
      <div class="actions">
        <button id="sendBtn" class="primary" disabled>Send</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const channelEl = document.getElementById('channel');
    const messageEl = document.getElementById('message');
    const sendBtn = document.getElementById('sendBtn');
    const formEl = document.getElementById('form');
    const emptyEl = document.getElementById('empty');
    const setupLink = document.getElementById('setupLink');

    let sending = false;

    function updateSendBtn() {
      sendBtn.disabled = sending || !channelEl.value || !messageEl.value.trim();
    }

    channelEl.addEventListener('change', updateSendBtn);
    messageEl.addEventListener('input', updateSendBtn);

    sendBtn.addEventListener('click', () => {
      if (sending || !channelEl.value || !messageEl.value.trim()) return;
      sending = true;
      sendBtn.disabled = true;
      sendBtn.textContent = 'Sending...';
      vscode.postMessage({ type: 'send', channelId: channelEl.value, text: messageEl.value.trim() });
    });

    setupLink.addEventListener('click', () => {
      vscode.postMessage({ type: 'requestChannels' });
    });

    // Ctrl+Enter / Cmd+Enter to send
    messageEl.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        sendBtn.click();
      }
    });

    window.addEventListener('message', (e) => {
      const msg = e.data;
      switch (msg.type) {
        case 'channels': {
          const channels = msg.channels || [];
          if (channels.length === 0) {
            formEl.style.display = 'none';
            emptyEl.style.display = 'block';
          } else {
            emptyEl.style.display = 'none';
            formEl.style.display = 'block';
            const prev = channelEl.value;
            channelEl.innerHTML = channels
              .map(ch => '<option value="' + ch.id + '">#' + ch.name + '</option>')
              .join('');
            if (prev && channels.some(ch => ch.id === prev)) {
              channelEl.value = prev;
            }
          }
          updateSendBtn();
          break;
        }
        case 'sent':
          messageEl.value = '';
          sending = false;
          sendBtn.textContent = 'Send';
          updateSendBtn();
          break;
        case 'error':
          sending = false;
          sendBtn.textContent = 'Send';
          updateSendBtn();
          break;
      }
    });

    vscode.postMessage({ type: 'requestChannels' });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
