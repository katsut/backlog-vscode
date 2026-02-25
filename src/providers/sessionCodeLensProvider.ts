import * as vscode from 'vscode';
import { SessionFileService } from '../services/session/sessionFileService';

export class SessionCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(private fileService: SessionFileService) {}

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const filePath = document.uri.fsPath;
    if (!this.fileService.isSessionFile(filePath)) {
      return [];
    }

    const parsed = this.fileService.parseSession(filePath);
    if (!parsed) {
      return [];
    }

    // Don't show CodeLens if already posted or no action
    if (parsed.meta.sessionStatus === 'posted' || parsed.meta.action === 'none') {
      return [];
    }

    // Find the DRAFT marker line
    const text = document.getText();
    const lines = text.split('\n');
    let markerLine = lines.findIndex((line) => line.includes('<!-- DRAFT -->'));
    if (markerLine < 0) {
      markerLine = 0;
    }

    const range = new vscode.Range(markerLine, 0, markerLine, 0);
    const lenses: vscode.CodeLens[] = [];

    // Post button based on action type
    if (parsed.meta.action === 'backlog-reply') {
      lenses.push(
        new vscode.CodeLens(range, {
          title: '$(cloud-upload) Backlog にコメント投稿',
          command: 'nulab.postSessionReply',
          arguments: [filePath],
        })
      );
    } else if (parsed.meta.action === 'slack-reply') {
      lenses.push(
        new vscode.CodeLens(range, {
          title: '$(comment-discussion) Slack に返信',
          command: 'nulab.postSessionReply',
          arguments: [filePath],
        })
      );
    }

    // Discard button (always shown for drafts)
    lenses.push(
      new vscode.CodeLens(range, {
        title: '$(trash) 破棄',
        command: 'nulab.discardSession',
        arguments: [filePath],
      })
    );

    return lenses;
  }
}
