import * as vscode from 'vscode';
import { SlackMentionItem } from '../../providers/slackTreeViewProvider';
import { SlackMessage, TodoContext } from '../../types/workspace';
import { SlackThreadWebview } from '../../webviews/slackThreadWebview';
import { ServiceContainer } from '../../container';

export function registerSlackCommands(c: ServiceContainer): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('workspace.setSlackToken', async () => {
      const token = await vscode.window.showInputBox({
        prompt: 'Slack User OAuth Token (xoxp-...) を入力',
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) => {
          if (value && !value.startsWith('xoxp-') && !value.startsWith('xoxb-')) {
            return 'トークンは xoxp- または xoxb- で始まる必要があります';
          }
          return null;
        },
      });
      if (!token) {
        return;
      }
      await c.slackConfig.setToken(token);
      try {
        await c.slackApi.reinitialize();
        const testResult = await c.slackApi.testConnection();
        if (testResult.ok) {
          vscode.commands.executeCommand('setContext', 'nulab.slack.configured', true);
          await c.slackProvider.fetchAndRefresh();
          await c.slackSearchProvider.fetchAndRefresh();
          const typeLabel = testResult.tokenType === 'bot' ? ' (Bot token — 通知の取得不可)' : '';
          vscode.window.showInformationMessage(
            `[Nulab] Slack 接続成功: ${testResult.user} @ ${testResult.team}${typeLabel}`
          );
        } else {
          vscode.window.showErrorMessage(`[Nulab] Slack 認証エラー: ${testResult.error}`);
        }
      } catch (error) {
        vscode.window.showErrorMessage(`[Nulab] Slack の初期化に失敗しました: ${error}`);
      }
    }),

    vscode.commands.registerCommand('workspace.refreshSlack', async () => {
      c.slackProvider.refresh();
      await c.slackProvider.fetchAndRefresh();
    }),

    vscode.commands.registerCommand('workspace.refreshSlackSearch', async () => {
      c.slackSearchProvider.refresh();
      await c.slackSearchProvider.fetchAndRefresh();
    }),

    vscode.commands.registerCommand('workspace.replyToSlack', async (item: SlackMentionItem) => {
      if (!(item instanceof SlackMentionItem)) {
        return;
      }
      const channel = item.message.channel;
      const threadTs = item.message.thread_ts || item.message.ts;

      if (!threadTs) {
        vscode.window.showWarningMessage('[Nulab] 返信先のスレッドが見つかりません。');
        return;
      }

      const text = await vscode.window.showInputBox({
        prompt: '返信を入力',
        placeHolder: 'メッセージ',
      });
      if (!text) {
        return;
      }

      try {
        await c.slackApi.postReply(channel, threadTs, text);
        vscode.window.showInformationMessage('[Nulab] 返信を送信しました。');
      } catch (error) {
        vscode.window.showErrorMessage(`[Nulab] 返信の送信に失敗しました: ${error}`);
      }
    }),

    vscode.commands.registerCommand(
      'workspace.openSlackThread',
      async (channel: string, threadTs: string, title: string) => {
        const panelKey = `${channel}-${threadTs}`;
        const existing = c.slackThreadPanels.get(panelKey);
        if (existing) {
          existing.reveal(vscode.ViewColumn.One);
          return;
        }

        const panel = vscode.window.createWebviewPanel(
          'slackThread',
          title || 'Slack Thread',
          vscode.ViewColumn.One,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [c.context.extensionUri],
          }
        );

        c.slackThreadPanels.set(panelKey, panel);

        try {
          panel.webview.html = '<html><body><p>Loading...</p></body></html>';

          const [messages, channelContext, slackPermalink] = await Promise.all([
            c.slackApi.getThreadMessages(channel, threadTs),
            c.slackApi.getChannelContext(channel, threadTs, 3),
            c.slackApi.getPermalink(channel, threadTs),
          ]);

          panel.webview.html = SlackThreadWebview.getWebviewContent(
            panel.webview,
            c.context.extensionUri,
            messages,
            title || 'Thread',
            slackPermalink,
            channelContext.before,
            channelContext.after
          );

          panel.webview.onDidReceiveMessage(
            async (message) => {
              if (message.command === 'reply' && message.text) {
                try {
                  await c.slackApi.postReply(channel, threadTs, message.text);
                  c.todoProvider.markRepliedBySlack(channel, threadTs);
                  const updated = await c.slackApi.getThreadMessages(channel, threadTs);
                  panel.webview.html = SlackThreadWebview.getWebviewContent(
                    panel.webview,
                    c.context.extensionUri,
                    updated,
                    title || 'Thread',
                    slackPermalink,
                    channelContext.before,
                    channelContext.after
                  );
                } catch (error) {
                  vscode.window.showErrorMessage(`[Nulab] 返信の送信に失敗しました: ${error}`);
                }
              }
              if (message.command === 'openExternal' && message.url) {
                vscode.env.openExternal(vscode.Uri.parse(message.url));
              }
              if (message.command === 'addToTodo') {
                const parentMsg = messages[0];
                const sender = parentMsg?.userName || parentMsg?.user || 'Unknown';
                const preview = (parentMsg?.text || '').substring(0, 100);
                const defaultText = `[Slack] ${sender}: ${preview}`;
                const text = await vscode.window.showInputBox({
                  prompt: 'TODO を入力',
                  value: defaultText,
                });
                if (text) {
                  c.todoProvider.addTodo(text, {
                    source: 'slack-mention',
                    slackChannel: channel,
                    slackThreadTs: threadTs,
                    slackMessageTs: parentMsg?.ts,
                    slackUserName: sender,
                    slackText: parentMsg?.text?.substring(0, 500),
                  });
                  vscode.window.showInformationMessage('[Nulab] TODO に追加しました');
                }
              }
            },
            undefined,
            c.context.subscriptions
          );
        } catch (error) {
          const errMsg = error instanceof Error ? error.message : String(error);
          panel.webview.html = `<html><body><p style="color:red;white-space:pre-wrap;">${errMsg}</p></body></html>`;
          vscode.window.showErrorMessage(`[Nulab] スレッド取得に失敗: ${errMsg}`);
        }
      }
    ),

    vscode.commands.registerCommand('workspace.openInSlack', async (item: SlackMentionItem) => {
      if (!(item instanceof SlackMentionItem)) {
        return;
      }
      const channelId = item.message.channel;
      const ts = item.message.thread_ts || item.message.ts;
      let url = `https://app.slack.com/client/${channelId}`;
      try {
        const permalink = await c.slackApi.getPermalink(channelId, ts);
        if (permalink) {
          url = permalink;
        }
      } catch {
        /* use fallback */
      }
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }),

    vscode.commands.registerCommand('workspace.addTodoFromSlack', async (item: unknown) => {
      const message =
        item && typeof item === 'object' && 'message' in item
          ? ((item as { message: SlackMessage }).message as SlackMessage)
          : undefined;
      if (!message) {
        return;
      }
      const sender = message.userName || message.user || 'Unknown';
      const preview = message.text.substring(0, 100);
      const defaultText = `[Slack] ${sender}: ${preview}`;

      const text = await vscode.window.showInputBox({
        prompt: 'TODO を入力',
        placeHolder: 'タスクの内容',
        value: defaultText,
      });
      if (text) {
        const context: TodoContext = {
          source: 'slack-mention',
          slackChannel: message.channel,
          slackThreadTs: message.thread_ts,
          slackMessageTs: message.ts,
          slackUserName: sender,
          slackText: message.text.substring(0, 500),
        };
        c.todoProvider.addTodo(text, context);
        vscode.window.showInformationMessage('[Nulab] TODO に追加しました');
      }
    }),

    vscode.commands.registerCommand('workspace.slackSearchViewGrouped', () => {
      if (c.slackSearchProvider.viewMode !== 'grouped') {
        c.slackSearchProvider.toggleViewMode();
      }
    }),

    vscode.commands.registerCommand('workspace.slackSearchViewFlat', () => {
      if (c.slackSearchProvider.viewMode !== 'flat') {
        c.slackSearchProvider.toggleViewMode();
      }
    }),

    vscode.commands.registerCommand('workspace.editSlackSearchKeywords', async () => {
      const current = c.slackConfig.getSearchKeywords();
      const action = await vscode.window.showQuickPick(
        [
          { label: '$(add) キーワードを追加', action: 'add' as const },
          ...(current.length > 0
            ? [{ label: '$(trash) キーワードを削除', action: 'remove' as const }]
            : []),
        ],
        { placeHolder: `現在のキーワード: ${current.length > 0 ? current.join(', ') : '(なし)'}` }
      );
      if (!action) {
        return;
      }

      if (action.action === 'add') {
        const keyword = await vscode.window.showInputBox({
          prompt: '追加するキーワードを入力',
          placeHolder: 'キーワード',
        });
        if (!keyword) {
          return;
        }
        if (current.includes(keyword)) {
          vscode.window.showInformationMessage(`[Nulab] "${keyword}" は既に登録されています。`);
          return;
        }
        const updated = [...current, keyword];
        c.slackConfig.setSearchKeywords(updated);
        vscode.window.showInformationMessage(`[Nulab] キーワード "${keyword}" を追加しました。`);
      } else {
        const toRemove = await vscode.window.showQuickPick(
          current.map((kw) => ({ label: kw })),
          { placeHolder: '削除するキーワードを選択', canPickMany: true }
        );
        if (!toRemove || toRemove.length === 0) {
          return;
        }
        const removeSet = new Set(toRemove.map((item) => item.label));
        const updated = current.filter((kw) => !removeSet.has(kw));
        c.slackConfig.setSearchKeywords(updated);
        vscode.window.showInformationMessage(
          `[Nulab] ${toRemove.length}件のキーワードを削除しました。`
        );
      }
    }),

    vscode.commands.registerCommand('workspace.postToSlack', async () => {
      const favorites = c.slackConfig.getFavoriteChannels();
      if (favorites.length === 0) {
        const setup = await vscode.window.showInformationMessage(
          '[Nulab] お気に入りチャンネルが未登録です。先に登録しますか？',
          '登録する'
        );
        if (setup) {
          await vscode.commands.executeCommand('workspace.editSlackFavoriteChannels');
        }
        return;
      }

      const selected = await vscode.window.showQuickPick(
        favorites.map((ch) => ({ label: `#${ch.name}`, channelId: ch.id })),
        { placeHolder: '投稿先チャンネルを選択' }
      );
      if (!selected) {
        return;
      }

      const text = await vscode.window.showInputBox({
        prompt: `#${selected.label} に投稿`,
        placeHolder: 'メッセージを入力',
      });
      if (!text) {
        return;
      }

      try {
        await c.slackApi.postMessage(selected.channelId, text);
        vscode.window.showInformationMessage(`[Nulab] ${selected.label} に投稿しました。`);
      } catch (error) {
        vscode.window.showErrorMessage(
          `[Nulab] 投稿に失敗しました: ${error instanceof Error ? error.message : error}`
        );
      }
    }),

    vscode.commands.registerCommand('workspace.editSlackFavoriteChannels', async () => {
      const current = c.slackConfig.getFavoriteChannels();
      const action = await vscode.window.showQuickPick(
        [
          { label: '$(add) チャンネルを追加', action: 'add' as const },
          ...(current.length > 0
            ? [{ label: '$(trash) チャンネルを削除', action: 'remove' as const }]
            : []),
        ],
        {
          placeHolder: `お気に入り: ${
            current.length > 0 ? current.map((ch) => '#' + ch.name).join(', ') : '(なし)'
          }`,
        }
      );
      if (!action) {
        return;
      }

      if (action.action === 'add') {
        const channels = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'チャンネル一覧を取得中...' },
          () => c.slackApi.getChannels()
        );
        const currentIds = new Set(current.map((ch) => ch.id));
        const available = channels
          .filter((ch) => !ch.is_im && !ch.is_mpim && !currentIds.has(ch.id))
          .map((ch) => ({ label: `#${ch.name}`, channel: { id: ch.id, name: ch.name } }));

        if (available.length === 0) {
          vscode.window.showInformationMessage('[Nulab] 追加可能なチャンネルがありません。');
          return;
        }

        const picked = await vscode.window.showQuickPick(available, {
          placeHolder: '追加するチャンネルを選択',
          canPickMany: true,
        });
        if (!picked || picked.length === 0) {
          return;
        }

        const updated = [...current, ...picked.map((p) => p.channel)];
        c.slackConfig.setFavoriteChannels(updated);
        vscode.window.showInformationMessage(
          `[Nulab] ${picked.length}件のチャンネルを追加しました。`
        );
      } else {
        const toRemove = await vscode.window.showQuickPick(
          current.map((ch) => ({ label: `#${ch.name}`, id: ch.id })),
          { placeHolder: '削除するチャンネルを選択', canPickMany: true }
        );
        if (!toRemove || toRemove.length === 0) {
          return;
        }
        const removeIds = new Set(toRemove.map((item) => item.id));
        const updated = current.filter((ch) => !removeIds.has(ch.id));
        c.slackConfig.setFavoriteChannels(updated);
        vscode.window.showInformationMessage(
          `[Nulab] ${toRemove.length}件のチャンネルを削除しました。`
        );
      }
    }),

    vscode.commands.registerCommand('workspace.refreshDocumentFiles', () => {
      c.documentFilesProvider.refresh();
    }),

    vscode.commands.registerCommand(
      'workspace.openDocumentFileFolder',
      (item: import('../../providers/documentFilesTreeViewProvider').MappingItem) => {
        const MappingItemClass =
          require('../../providers/documentFilesTreeViewProvider').MappingItem;
        if (item instanceof MappingItemClass) {
          const folders = vscode.workspace.workspaceFolders;
          if (folders) {
            const path = require('path');
            const localDir = path.join(folders[0].uri.fsPath, item.mapping.localPath);
            vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(localDir));
          }
        }
      }
    ),
  ];
}
