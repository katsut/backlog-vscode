import * as vscode from 'vscode';
import { execFile } from 'child_process';

/**
 * Open a URL using the system handler.
 * On macOS, uses `open` command which respects registered app handlers
 * (e.g. Slack app for slack.com URLs, Meet app for meet.google.com).
 * Falls back to vscode.env.openExternal on other platforms.
 */
export function openUrl(url: string): void {
  if (process.platform === 'darwin') {
    execFile('open', [url], (err) => {
      if (err) {
        vscode.env.openExternal(vscode.Uri.parse(url));
      }
    });
  } else {
    vscode.env.openExternal(vscode.Uri.parse(url));
  }
}
