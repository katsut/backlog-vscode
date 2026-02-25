import * as vscode from 'vscode';
import { GoogleApiService } from '../../services/googleApi';
import { GoogleConfig } from '../../config/googleConfig';
import {
  GoogleCalendarTreeViewProvider,
  DocumentItem,
  EventItem,
} from '../../providers/googleCalendarTreeViewProvider';
import { GoogleDriveFile, GoogleCalendarEvent } from '../../types/google';

export function registerGoogleCalendar(
  context: vscode.ExtensionContext,
  googleConfig: GoogleConfig,
  log: (message: string) => void
): { disposables: vscode.Disposable[]; treeView: vscode.TreeView<any> } {
  const googleApi = new GoogleApiService(googleConfig);
  const calendarProvider = new GoogleCalendarTreeViewProvider(googleApi, context.extensionUri);

  const calendarTreeView = vscode.window.createTreeView('workspaceGoogleCalendar', {
    treeDataProvider: calendarProvider,
    showCollapseAll: true,
  });

  const setClientSecretCmd = vscode.commands.registerCommand(
    'nulab.google.setClientSecret',
    async () => {
      const secret = await vscode.window.showInputBox({
        prompt: 'Google OAuth Client Secret を入力してください',
        password: true,
        ignoreFocusOut: true,
      });
      if (secret) {
        await googleConfig.setClientSecret(secret);
        vscode.window.showInformationMessage('Google Client Secret を保存しました。');
      }
    }
  );

  const authenticateCmd = vscode.commands.registerCommand('nulab.google.authenticate', async () => {
    try {
      await googleApi.authenticate();
      calendarProvider.refresh();
      vscode.window.showInformationMessage('Google アカウントの認証が完了しました。');
    } catch (error) {
      vscode.window.showErrorMessage(
        `Google 認証に失敗: ${error instanceof Error ? error.message : error}`
      );
    }
  });

  const signOutCmd = vscode.commands.registerCommand('nulab.google.signOut', async () => {
    await googleApi.signOut();
    calendarProvider.refresh();
    vscode.window.showInformationMessage('Google アカウントからサインアウトしました。');
  });

  const refreshCmd = vscode.commands.registerCommand('nulab.google.refreshCalendar', () => {
    googleApi.reinitialize();
    calendarProvider.refresh();
  });

  const openMeetingNotesCmd = vscode.commands.registerCommand(
    'nulab.google.openMeetingNotes',
    async (file: GoogleDriveFile, event: GoogleCalendarEvent) => {
      log(`openMeetingNotes: file=${file?.name} (${file?.id}), event=${event?.summary}`);
      if (!file || !event) {
        log('openMeetingNotes: missing file or event argument');
        return;
      }

      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        log('openMeetingNotes: no workspace folder');
        vscode.window.showErrorMessage('ワークスペースが開かれていません。');
        return;
      }

      try {
        const nulabDir = vscode.Uri.joinPath(wsFolder.uri, '.nulab', 'meeting-notes');
        await vscode.workspace.fs.createDirectory(nulabDir);

        const eventDate = (event.start.dateTime || event.start.date || '').split('T')[0];
        const safeName = (event.summary || 'meeting')
          .replace(/[/\\:*?"<>|]/g, '_')
          .substring(0, 60);
        const fileName = `${eventDate}_${safeName}.gdoc`;
        const fileUri = vscode.Uri.joinPath(nulabDir, fileName);

        let fileExists = false;
        try {
          await vscode.workspace.fs.stat(fileUri);
          fileExists = true;
        } catch {
          // File does not exist
        }

        if (!fileExists) {
          log(`openMeetingNotes: fetching content for file ${file.id}`);
          const html = await googleApi.getFileContent(file.id);
          const plainText = html
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, '\n')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

          const attendees = (event.attendees || [])
            .filter((a) => !a.self)
            .map((a) => a.displayName || a.email);

          let timeStr = '';
          if (event.start.dateTime && event.end.dateTime) {
            const s = new Date(event.start.dateTime);
            const e = new Date(event.end.dateTime);
            const tf = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
            timeStr = `${eventDate} ${tf(s)} - ${tf(e)}`;
          }

          const attendeeYaml =
            attendees.length > 0 ? attendees.map((a) => `  - ${a}`).join('\n') : '  []';

          const fm = [
            '---',
            `event: "${(event.summary || '').replace(/"/g, '\\"')}"`,
            `date: "${timeStr || eventDate}"`,
            'attendees:',
            attendeeYaml,
            file.webViewLink ? `source: "${file.webViewLink}"` : null,
            event.hangoutLink ? `meet: "${event.hangoutLink}"` : null,
            '---',
          ]
            .filter(Boolean)
            .join('\n');

          log(`openMeetingNotes: writing gdoc file ${fileUri.fsPath}`);
          await vscode.workspace.fs.writeFile(
            fileUri,
            Buffer.from(`${fm}\n\n${plainText}`, 'utf-8')
          );
          log(`openMeetingNotes: gdoc file created`);
        } else {
          log(`openMeetingNotes: gdoc file already exists, reusing`);
        }

        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc, {
          preview: false,
          viewColumn: vscode.ViewColumn.One,
        });
      } catch (error) {
        log(`openMeetingNotes: error - ${error}`);
        vscode.window.showErrorMessage(
          `議事録の取得に失敗しました: ${error instanceof Error ? error.message : error}`
        );
      }
    }
  );

  const openInBrowserCmd = vscode.commands.registerCommand(
    'nulab.google.openInBrowser',
    (item: EventItem | DocumentItem) => {
      if (item instanceof DocumentItem && item.file.webViewLink) {
        vscode.env.openExternal(vscode.Uri.parse(item.file.webViewLink));
      } else if (item instanceof EventItem && item.event.htmlLink) {
        vscode.env.openExternal(vscode.Uri.parse(item.event.htmlLink));
      }
    }
  );

  const openSelectedCalendarItemCmd = vscode.commands.registerCommand(
    'nulab.google.openSelectedCalendarItem',
    () => {
      const selected = calendarTreeView.selection[0];
      if (selected instanceof DocumentItem && selected.file && selected.event) {
        vscode.commands.executeCommand(
          'nulab.google.openMeetingNotes',
          selected.file,
          selected.event
        );
      }
    }
  );

  return {
    treeView: calendarTreeView,
    disposables: [
      calendarTreeView,
      setClientSecretCmd,
      authenticateCmd,
      signOutCmd,
      refreshCmd,
      openMeetingNotesCmd,
      openInBrowserCmd,
      openSelectedCalendarItemCmd,
    ],
  };
}
