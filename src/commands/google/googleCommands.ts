import * as vscode from 'vscode';
import { GoogleApiService } from '../../services/googleApi';
import { GoogleConfig } from '../../config/googleConfig';
import {
  GoogleCalendarTreeViewProvider,
  DocumentItem,
  EventItem,
} from '../../providers/googleCalendarTreeViewProvider';
import { GoogleDriveFile, GoogleCalendarEvent } from '../../types/google';
import { CalendarEventWebview } from '../../webviews/calendarEventWebview';
import { MeetingNotesWebview } from '../../webviews/meetingNotesWebview';
import { TodoTreeViewProvider } from '../../providers/todoTreeViewProvider';
import { TodoPersistenceService } from '../../services/session/todoPersistenceService';
import {
  GoogleDriveSearchTreeViewProvider,
  DriveFileItem,
} from '../../providers/googleDriveSearchTreeViewProvider';

export function registerGoogleCalendar(
  context: vscode.ExtensionContext,
  googleConfig: GoogleConfig,
  log: (message: string) => void,
  todoProvider?: TodoTreeViewProvider,
  todoPersistence?: TodoPersistenceService
): { disposables: vscode.Disposable[]; treeViews: vscode.TreeView<any>[] } {
  log('registerGoogleCalendar: START');
  const googleApi = new GoogleApiService(googleConfig);
  const calendarProvider = new GoogleCalendarTreeViewProvider(googleApi, context.extensionUri);

  const calendarTreeView = vscode.window.createTreeView('workspaceGoogleCalendar', {
    treeDataProvider: calendarProvider,
    showCollapseAll: true,
  });

  const driveSearchProvider = new GoogleDriveSearchTreeViewProvider(googleApi);
  const driveTreeView = vscode.window.createTreeView('workspaceGoogleDrive', {
    treeDataProvider: driveSearchProvider,
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

  /** Build the .gdoc file URI for an event */
  function gdocFileUri(event: GoogleCalendarEvent): vscode.Uri | null {
    const wsFolder = vscode.workspace.workspaceFolders?.[0];
    if (!wsFolder) return null;
    const eventDate = (event.start.dateTime || event.start.date || '').split('T')[0];
    const safeName = (event.summary || 'meeting').replace(/[/\\:*?"<>|]/g, '_').substring(0, 60);
    return vscode.Uri.joinPath(
      wsFolder.uri,
      '.nulab',
      'meeting-notes',
      `${eventDate}_${safeName}.gdoc`
    );
  }

  /** Fetch Google Doc HTML and write .gdoc file */
  async function fetchAndWriteGdoc(
    file: GoogleDriveFile,
    event: GoogleCalendarEvent,
    fileUri: vscode.Uri
  ): Promise<void> {
    const html = await googleApi.getFileContent(file.id);
    const meta = JSON.stringify({ event, file });
    const dir = vscode.Uri.joinPath(fileUri, '..');
    await vscode.workspace.fs.createDirectory(dir);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(`${meta}\n${html}`, 'utf-8'));
  }

  const openMeetingNotesCmd = vscode.commands.registerCommand(
    'nulab.google.openMeetingNotes',
    async (file: GoogleDriveFile, event: GoogleCalendarEvent) => {
      log(`openMeetingNotes: file=${file?.name} (${file?.id}), event=${event?.summary}`);
      if (!file || !event) {
        log('openMeetingNotes: missing file or event argument');
        return;
      }

      const fileUri = gdocFileUri(event);
      if (!fileUri) {
        vscode.window.showErrorMessage('ワークスペースが開かれていません。');
        return;
      }

      try {
        let fileExists = false;
        try {
          await vscode.workspace.fs.stat(fileUri);
          fileExists = true;
        } catch {
          // File does not exist
        }

        if (!fileExists) {
          log(`openMeetingNotes: fetching content for file ${file.id}`);
          await fetchAndWriteGdoc(file, event, fileUri);
          log(`openMeetingNotes: gdoc file created`);
        }

        await vscode.commands.executeCommand('vscode.openWith', fileUri, 'nulab.gdocEditor');
      } catch (error) {
        log(`openMeetingNotes: error - ${error}`);
        vscode.window.showErrorMessage(
          `議事録の取得に失敗しました: ${error instanceof Error ? error.message : error}`
        );
      }
    }
  );

  const refreshMeetingNotesCmd = vscode.commands.registerCommand(
    'nulab.google.refreshMeetingNotes',
    async (item: DocumentItem) => {
      if (!(item instanceof DocumentItem) || !item.file || !item.event) return;

      const fileUri = gdocFileUri(item.event);
      if (!fileUri) {
        vscode.window.showErrorMessage('ワークスペースが開かれていません。');
        return;
      }

      try {
        log(`refreshMeetingNotes: pulling latest for ${item.file.name}`);
        await fetchAndWriteGdoc(item.file, item.event, fileUri);
        // Reopen to refresh the custom editor
        await vscode.commands.executeCommand('vscode.openWith', fileUri, 'nulab.gdocEditor');
        vscode.window.showInformationMessage('議事録を更新しました');
      } catch (error) {
        log(`refreshMeetingNotes: error - ${error}`);
        vscode.window.showErrorMessage(
          `議事録の更新に失敗しました: ${error instanceof Error ? error.message : error}`
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

  const eventDetailPanels = new Map<string, vscode.WebviewPanel>();

  const openEventDetailCmd = vscode.commands.registerCommand(
    'nulab.google.openEventDetail',
    (event: GoogleCalendarEvent) => {
      if (!event) return;

      const existing = eventDetailPanels.get(event.id);
      if (existing) {
        existing.reveal(vscode.ViewColumn.One);
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        'calendarEvent',
        event.summary || 'Event',
        vscode.ViewColumn.One,
        { enableScripts: true, localResourceRoots: [context.extensionUri] }
      );

      eventDetailPanels.set(event.id, panel);
      panel.onDidDispose(() => eventDetailPanels.delete(event.id));

      panel.webview.html = CalendarEventWebview.getWebviewContent(
        panel.webview,
        context.extensionUri,
        event
      );

      panel.webview.onDidReceiveMessage(
        (msg) => {
          if (msg.command === 'openExternal' && msg.url) {
            vscode.env.openExternal(vscode.Uri.parse(msg.url));
          }
        },
        undefined,
        context.subscriptions
      );
    }
  );

  const openSelectedCalendarItemCmd = vscode.commands.registerCommand(
    'nulab.google.openSelectedCalendarItem',
    () => {
      const selected = calendarTreeView.selection[0];
      if (selected instanceof EventItem && selected.event) {
        vscode.commands.executeCommand('nulab.google.openEventDetail', selected.event);
      } else if (selected instanceof DocumentItem && selected.file && selected.event) {
        vscode.commands.executeCommand(
          'nulab.google.openMeetingNotes',
          selected.file,
          selected.event
        );
      }
    }
  );

  log(
    `addToTodo: registering command, hasTodoProvider=${!!todoProvider}, hasTodoPersistence=${!!todoPersistence}`
  );
  const addToTodoCmd = vscode.commands.registerCommand(
    'nulab.google.addToTodo',
    async (item: DocumentItem) => {
      log(`addToTodo: called, item=${item?.constructor?.name}, hasTodoProvider=${!!todoProvider}`);
      if (!todoProvider || !todoPersistence) {
        log('addToTodo: missing todoProvider or todoPersistence');
        return;
      }
      if (!(item instanceof DocumentItem) || !item.file || !item.event) {
        log(`addToTodo: invalid item, instanceof=${item instanceof DocumentItem}`);
        return;
      }

      const file = item.file;
      const event = item.event;
      const eventDate = (event.start.dateTime || event.start.date || '').split('T')[0];

      const attendees = (event.attendees || [])
        .filter((a: any) => !a.self)
        .map((a: any) => a.displayName || a.email);

      let timeStr = '';
      if (event.start.dateTime && event.end.dateTime) {
        const s = new Date(event.start.dateTime);
        const e = new Date(event.end.dateTime);
        const tf = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
        timeStr = `${eventDate} ${tf(s)} - ${tf(e)}`;
      }

      const todo = todoProvider.addFromGoogleDoc({
        eventSummary: event.summary || 'meeting',
        eventDate: timeStr || eventDate,
        docId: file.id,
        docUrl: file.webViewLink,
        meetUrl: event.hangoutLink,
        attendees,
      });

      if (!todo) {
        vscode.window.showInformationMessage('[Nulab] この議事録の TODO は既にあります。');
        return;
      }

      // Fetch doc content and build full context
      try {
        const html = await googleApi.getFileContent(file.id);
        const plainText = htmlToPlainText(html);
        todoPersistence.startGoogleDocSession(todo, plainText);
      } catch (err) {
        log(`addToTodo: failed to fetch doc content: ${err}`);
      }

      vscode.commands.executeCommand('workspace.openTodoDetail', todo.id);
    }
  );

  const addToTodoFromDocCmd = vscode.commands.registerCommand(
    'nulab.google.addToTodoFromDoc',
    async (gdocData: { event: GoogleCalendarEvent; file: GoogleDriveFile }) => {
      log(`addToTodoFromDoc: called`);
      if (!todoProvider || !todoPersistence) {
        log('addToTodoFromDoc: missing todoProvider or todoPersistence');
        return;
      }
      if (!gdocData || !gdocData.event || !gdocData.file) {
        log('addToTodoFromDoc: invalid gdocData');
        return;
      }

      const { event, file } = gdocData;
      const eventDate = (event.start.dateTime || event.start.date || '').split('T')[0];

      const attendees = (event.attendees || [])
        .filter((a: any) => !a.self)
        .map((a: any) => a.displayName || a.email);

      let timeStr = '';
      if (event.start.dateTime && event.end.dateTime) {
        const s = new Date(event.start.dateTime);
        const e = new Date(event.end.dateTime);
        const tf = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
        timeStr = `${eventDate} ${tf(s)} - ${tf(e)}`;
      }

      const todo = todoProvider.addFromGoogleDoc({
        eventSummary: event.summary || 'meeting',
        eventDate: timeStr || eventDate,
        docId: file.id,
        docUrl: file.webViewLink,
        meetUrl: event.hangoutLink,
        attendees,
      });

      if (!todo) {
        vscode.window.showInformationMessage('[Nulab] この議事録の TODO は既にあります。');
        return;
      }

      // Fetch doc content and build full context
      try {
        const html = await googleApi.getFileContent(file.id);
        const plainText = htmlToPlainText(html);
        todoPersistence.startGoogleDocSession(todo, plainText);
      } catch (err) {
        log(`addToTodoFromDoc: failed to fetch doc content: ${err}`);
      }

      vscode.window.showInformationMessage('[Nulab] TODO に追加しました');
      vscode.commands.executeCommand('workspace.openTodoDetail', todo.id);
    }
  );

  const searchDriveCmd = vscode.commands.registerCommand('nulab.google.searchDrive', async () => {
    const query = await vscode.window.showInputBox({
      prompt: 'Google Drive を検索',
      placeHolder: 'ファイル名やキーワードを入力',
      value: driveSearchProvider.getLastQuery(),
    });
    if (!query) return;

    driveTreeView.title = `Google: Drive — "${query}"`;
    await vscode.window.withProgress({ location: { viewId: 'workspaceGoogleDrive' } }, () =>
      driveSearchProvider.search(query)
    );
  });

  const clearDriveSearchCmd = vscode.commands.registerCommand(
    'nulab.google.clearDriveSearch',
    () => {
      driveSearchProvider.clear();
      driveTreeView.title = 'Google: Drive';
    }
  );

  const openDriveFileCmd = vscode.commands.registerCommand(
    'nulab.google.openDriveFile',
    (file: GoogleDriveFile) => {
      if (file) openDriveFile(file, googleApi, log);
    }
  );

  const openDriveFileInBrowserCmd = vscode.commands.registerCommand(
    'nulab.google.openDriveFileInBrowser',
    (item: DriveFileItem) => {
      if (item instanceof DriveFileItem && item.file.webViewLink) {
        vscode.env.openExternal(vscode.Uri.parse(item.file.webViewLink));
      }
    }
  );

  return {
    treeViews: [calendarTreeView, driveTreeView],
    disposables: [
      calendarTreeView,
      driveTreeView,
      setClientSecretCmd,
      authenticateCmd,
      signOutCmd,
      refreshCmd,
      openMeetingNotesCmd,
      refreshMeetingNotesCmd,
      openInBrowserCmd,
      openEventDetailCmd,
      openSelectedCalendarItemCmd,
      addToTodoCmd,
      addToTodoFromDocCmd,
      searchDriveCmd,
      clearDriveSearchCmd,
      openDriveFileCmd,
      openDriveFileInBrowserCmd,
    ],
  };
}

async function openDriveFile(
  file: GoogleDriveFile,
  googleApi: GoogleApiService,
  log: (msg: string) => void
): Promise<void> {
  const mime = file.mimeType;

  // Google Docs → .gdoc カスタムエディタ
  if (mime === 'application/vnd.google-apps.document') {
    try {
      const html = await googleApi.getFileContent(file.id);
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.env.openExternal(vscode.Uri.parse(file.webViewLink));
        return;
      }
      const safeName = file.name.replace(/[/\\:*?"<>|]/g, '_').substring(0, 60);
      const fileUri = vscode.Uri.joinPath(
        wsFolder.uri,
        '.nulab',
        'drive-search',
        `${safeName}.gdoc`
      );
      const dummyEvent = { id: '', summary: file.name, start: {}, end: {}, htmlLink: '' };
      const meta = JSON.stringify({ event: dummyEvent, file });
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(fileUri, '..'));
      await vscode.workspace.fs.writeFile(fileUri, Buffer.from(`${meta}\n${html}`, 'utf-8'));
      await vscode.commands.executeCommand('vscode.openWith', fileUri, 'nulab.gdocEditor');
    } catch (error) {
      log(`searchDrive: failed to open doc: ${error}`);
      vscode.env.openExternal(vscode.Uri.parse(file.webViewLink));
    }
    return;
  }

  // テキスト → VSCode テキストエディタ
  if (mime.startsWith('text/')) {
    try {
      const content = await googleApi.downloadFile(file.id);
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.env.openExternal(vscode.Uri.parse(file.webViewLink));
        return;
      }
      const safeName = file.name.replace(/[/\\:*?"<>|]/g, '_');
      const fileUri = vscode.Uri.joinPath(wsFolder.uri, '.nulab', 'drive-search', safeName);
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(fileUri, '..'));
      await vscode.workspace.fs.writeFile(fileUri, content);
      await vscode.window.showTextDocument(fileUri);
    } catch (error) {
      log(`searchDrive: failed to open text: ${error}`);
      vscode.env.openExternal(vscode.Uri.parse(file.webViewLink));
    }
    return;
  }

  // 画像 → VSCode 画像ビューア
  if (mime.startsWith('image/')) {
    try {
      const content = await googleApi.downloadFile(file.id);
      const wsFolder = vscode.workspace.workspaceFolders?.[0];
      if (!wsFolder) {
        vscode.env.openExternal(vscode.Uri.parse(file.webViewLink));
        return;
      }
      const safeName = file.name.replace(/[/\\:*?"<>|]/g, '_');
      const fileUri = vscode.Uri.joinPath(wsFolder.uri, '.nulab', 'drive-search', safeName);
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(fileUri, '..'));
      await vscode.workspace.fs.writeFile(fileUri, content);
      await vscode.commands.executeCommand('vscode.open', fileUri);
    } catch (error) {
      log(`searchDrive: failed to open image: ${error}`);
      vscode.env.openExternal(vscode.Uri.parse(file.webViewLink));
    }
    return;
  }

  // その他 → ブラウザ
  vscode.env.openExternal(vscode.Uri.parse(file.webViewLink));
}

/** Convert Google Docs HTML export to readable plain text */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|h[1-6]|li|tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
