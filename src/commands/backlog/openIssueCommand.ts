import * as vscode from 'vscode';
import { Entity } from 'backlog-js';
import { ServiceContainer } from '../../container';
import { IssueWebview } from '../../webviews/issueWebview';
import { WebviewHelper } from '../../webviews/common';
import { openUrl } from '../../utils/openUrl';

export function registerOpenIssueCommands(c: ServiceContainer): vscode.Disposable[] {
  const setupIssueMessageHandler = (
    panel: vscode.WebviewPanel,
    issue: Entity.Issue.Issue
  ): void => {
    panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'openExternal':
            openUrl(message.url);
            break;
          case 'addToTodo': {
            const defaultText = `[${issue.issueKey}] ${issue.summary}`;
            const text = await vscode.window.showInputBox({
              prompt: 'TODO を入力',
              value: defaultText,
            });
            if (text) {
              c.todoProvider.addTodo(text, {
                source: 'backlog-notification',
                issueKey: issue.issueKey,
                issueId: issue.id,
                issueSummary: issue.summary,
              });
              vscode.window.showInformationMessage('[Nulab] TODO に追加しました');
            }
            break;
          }
          case 'refreshIssue':
            try {
              const [refreshedIssue, refreshedComments] = await Promise.all([
                c.backlogApi.getIssue(message.issueId),
                c.backlogApi.getIssueComments(message.issueId),
              ]);
              panel.webview.html = await IssueWebview.getWebviewContent(
                panel.webview,
                c.context.extensionUri,
                refreshedIssue,
                refreshedComments,
                c.backlogConfig.getBaseUrl(),
                c.backlogApi
              );
            } catch (error) {
              console.error('Error refreshing issue:', error);
              vscode.window.showErrorMessage(`[Nulab] Failed to refresh issue: ${error}`);
            }
            break;
        }
      },
      undefined,
      c.context.subscriptions
    );
  };

  const createIssuePanel = (issueKey: string): vscode.WebviewPanel => {
    const panel = vscode.window.createWebviewPanel(
      'backlogIssue',
      `Issue ${issueKey}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [c.context.extensionUri],
      }
    );
    c.issuePanels.set(issueKey, panel);
    return panel;
  };

  return [
    vscode.commands.registerCommand('nulab.openIssue', async (issue: Entity.Issue.Issue) => {
      const issueKey = issue.issueKey || `${issue.id}`;

      const existingPanel = c.issuePanels.get(issueKey);
      if (existingPanel) {
        existingPanel.reveal(vscode.ViewColumn.One);
        try {
          const issueDetail = await c.backlogApi.getIssue(issue.id);
          const issueComments = await c.backlogApi.getIssueComments(issue.id);
          existingPanel.webview.html = await IssueWebview.getWebviewContent(
            existingPanel.webview,
            c.context.extensionUri,
            issueDetail,
            issueComments,
            undefined,
            c.backlogApi
          );
        } catch (error) {
          existingPanel.webview.html = WebviewHelper.getErrorWebviewContent(
            `Failed to load issue: ${error}`
          );
        }
        return;
      }

      const panel = createIssuePanel(issueKey);

      try {
        const issueDetail = await c.backlogApi.getIssue(issue.id);
        const issueComments = await c.backlogApi.getIssueComments(issue.id);

        panel.webview.html = await IssueWebview.getWebviewContent(
          panel.webview,
          c.context.extensionUri,
          issueDetail,
          issueComments,
          c.backlogConfig.getBaseUrl(),
          c.backlogApi
        );

        setupIssueMessageHandler(panel, issueDetail);
      } catch (error) {
        panel.webview.html = WebviewHelper.getErrorWebviewContent(`Failed to load issue: ${error}`);
      }
    }),

    vscode.commands.registerCommand('nulab.openIssueByKey', async () => {
      const issueKey = await vscode.window.showInputBox({
        prompt: 'Enter Backlog issue key to open',
        placeHolder: 'e.g., PROJ-123, DEV-456',
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return 'Issue key cannot be empty';
          }
          if (!/^[A-Z][A-Z0-9_]*-\d+$/i.test(value.trim())) {
            return 'Issue key should be in format: PROJECT-123';
          }
          return null;
        },
      });

      if (!issueKey) {
        return;
      }

      try {
        const trimmedKey = issueKey.trim();

        const existingPanel = c.issuePanels.get(trimmedKey);
        if (existingPanel) {
          existingPanel.reveal(vscode.ViewColumn.One);
          return;
        }

        const panel = createIssuePanel(trimmedKey);
        panel.webview.html = WebviewHelper.getLoadingWebviewContent('Loading issue...');

        try {
          let issueSearchResult: Entity.Issue.Issue | null = null;
          const projectKey = trimmedKey.split('-')[0];

          try {
            const projects = await c.backlogApi.getProjects();
            const project = projects.find(
              (p: Entity.Project.Project) => p.projectKey.toLowerCase() === projectKey.toLowerCase()
            );

            if (project) {
              await vscode.commands.executeCommand('nulab.focusProject', project.id);

              const issues = await c.backlogApi.getProjectIssues(project.id, {
                keyword: trimmedKey,
              });

              issueSearchResult =
                issues.find((issue: Entity.Issue.Issue) => issue.issueKey === trimmedKey) || null;
            }
          } catch (apiError) {
            console.error('API search failed:', apiError);
          }

          if (issueSearchResult) {
            const [issueDetail, issueComments] = await Promise.all([
              c.backlogApi.getIssue(issueSearchResult.id),
              c.backlogApi.getIssueComments(issueSearchResult.id),
            ]);

            panel.webview.html = await IssueWebview.getWebviewContent(
              panel.webview,
              c.context.extensionUri,
              issueDetail,
              issueComments,
              c.backlogConfig.getBaseUrl(),
              c.backlogApi
            );

            setupIssueMessageHandler(panel, issueDetail);
          } else {
            panel.webview.html = WebviewHelper.getErrorWebviewContent(
              `Issue not found: ${trimmedKey}. Please check the issue key and project permissions.`
            );
          }
        } catch (error) {
          console.error('Failed to find issue:', error);
          panel.webview.html = WebviewHelper.getErrorWebviewContent(
            `Failed to find issue: ${trimmedKey}. Error: ${error}`
          );
        }
      } catch (error) {
        console.error('Error in openIssueByKey:', error);
        vscode.window.showErrorMessage(`[Nulab] Failed to open issue: ${error}`);
      }
    }),

    vscode.commands.registerCommand(
      'nulab.openIssueAfterMCPOperation',
      async (issueId: number | string, issueKey?: string) => {
        try {
          c.backlogIssuesProvider.refresh();

          const numericIssueId = typeof issueId === 'string' ? parseInt(issueId, 10) : issueId;
          const issueDetail = await c.backlogApi.getIssue(numericIssueId);
          const resolvedIssueKey = issueKey || issueDetail.issueKey || `${issueId}`;

          const existingPanel = c.issuePanels.get(resolvedIssueKey);
          if (existingPanel) {
            existingPanel.reveal(vscode.ViewColumn.One);
            const issueComments = await c.backlogApi.getIssueComments(numericIssueId);
            existingPanel.webview.html = await IssueWebview.getWebviewContent(
              existingPanel.webview,
              c.context.extensionUri,
              issueDetail,
              issueComments,
              undefined,
              c.backlogApi
            );
          } else {
            const panel = createIssuePanel(resolvedIssueKey);
            const issueComments = await c.backlogApi.getIssueComments(numericIssueId);
            panel.webview.html = await IssueWebview.getWebviewContent(
              panel.webview,
              c.context.extensionUri,
              issueDetail,
              issueComments,
              undefined,
              c.backlogApi
            );

            setupIssueMessageHandler(panel, issueDetail);
          }
        } catch (error) {
          console.error('Error in openIssueAfterMCPOperation:', error);
          vscode.window.showErrorMessage(
            `[Nulab] Failed to open issue after MCP operation: ${error}`
          );
        }
      }
    ),
  ];
}
