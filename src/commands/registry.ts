import * as vscode from 'vscode';
import { ServiceContainer } from '../container';
import { registerRefreshCommands } from './backlog/refreshCommands';
import { registerSettingsCommands } from './backlog/settingsCommands';
import { registerProjectCommands } from './backlog/projectCommands';
import { registerFilterSortCommands } from './backlog/filterSortCommands';
import { registerOpenIssueCommands } from './backlog/openIssueCommand';
import { registerOpenWikiCommand } from './backlog/openWikiCommand';
import { registerOpenDocumentCommand } from './backlog/openDocumentCommand';
import { registerMappingCommands } from './documentSync/mappingCommands';
import { registerTodoCommands } from './workspace/todoCommands';
import { registerNotificationCommands } from './workspace/notificationCommands';
import { registerSlackCommands } from './workspace/slackCommands';
import { registerSessionCommands } from './workspace/sessionCommands';

export interface TreeViews {
  todosTreeView: vscode.TreeView<any>;
  notificationsTreeView: vscode.TreeView<any>;
  slackTreeView: vscode.TreeView<any>;
  slackSearchTreeView: vscode.TreeView<any>;
}

export function registerAllCommands(c: ServiceContainer, tv: TreeViews): vscode.Disposable[] {
  return [
    ...registerRefreshCommands(c),
    ...registerSettingsCommands(c),
    ...registerProjectCommands(c),
    ...registerFilterSortCommands(c),
    ...registerOpenIssueCommands(c),
    ...registerOpenWikiCommand(c),
    ...registerOpenDocumentCommand(c),
    ...registerMappingCommands(c),
    ...registerTodoCommands(c, tv.todosTreeView),
    ...registerNotificationCommands(c, tv.notificationsTreeView),
    ...registerSlackCommands(c, tv.slackTreeView, tv.slackSearchTreeView),
    ...registerSessionCommands(c),
  ];
}
