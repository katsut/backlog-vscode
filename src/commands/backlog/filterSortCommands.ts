import * as vscode from 'vscode';
import { ServiceContainer } from '../../container';

export function registerFilterSortCommands(c: ServiceContainer): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('nulab.searchProjects', async () => {
      const query = await vscode.window.showInputBox({
        prompt: 'Search projects by name or key',
        placeHolder: 'Enter search query (name, key, or description)',
      });

      if (query !== undefined) {
        await c.backlogTreeViewProvider.search(query);
      }
    }),

    vscode.commands.registerCommand('nulab.clearProjectSearch', () => {
      c.backlogTreeViewProvider.search('');
    }),

    vscode.commands.registerCommand('nulab.search', async () => {
      const query = await vscode.window.showInputBox({
        prompt: 'Search issues by keyword',
        placeHolder: 'Enter search query (title, key, or description)',
      });

      if (query !== undefined) {
        await c.backlogIssuesProvider.searchIssues(query);
      }
    }),

    vscode.commands.registerCommand('nulab.filter', async () => {
      const filterOptions = [
        { label: '🔴 Open Issues Only', description: 'Show only unresolved issues', value: 'open' },
        {
          label: '🔍 Non-Closed Issues',
          description: 'Show all issues except closed ones',
          value: 'nonClosed',
        },
        { label: '👤 My Issues', description: 'Show issues assigned to me', value: 'my' },
        { label: '⏰ Overdue Issues', description: 'Show issues past due date', value: 'overdue' },
        { label: '🎯 Status Filter', description: 'Filter by specific status', value: 'status' },
        {
          label: '🔥 Priority Filter',
          description: 'Filter by priority level',
          value: 'priority',
        },
        { label: '👥 Assignee Filter', description: 'Filter by assignee', value: 'assignee' },
        {
          label: '🧹 Clear All Filters',
          description: 'Remove all filters and show all issues',
          value: 'clear',
        },
      ];

      const selectedFilter = await vscode.window.showQuickPick(filterOptions, {
        placeHolder: 'Select filter type',
      });

      if (!selectedFilter) {
        return;
      }

      switch (selectedFilter.value) {
        case 'open':
          await c.backlogIssuesProvider.filterOpenIssues();
          break;
        case 'nonClosed':
          await c.backlogIssuesProvider.filterNonClosedIssues();
          break;
        case 'my':
          await c.backlogIssuesProvider.filterMyIssues();
          break;
        case 'overdue':
          await c.backlogIssuesProvider.filterOverdueIssues();
          break;
        case 'status': {
          const statusOptions = [
            'Open',
            'In Progress',
            'Resolved',
            'Closed',
            'オープン',
            '処理中',
            '解決済み',
            'クローズ',
          ];
          const selectedStatuses = await vscode.window.showQuickPick(statusOptions, {
            canPickMany: true,
            placeHolder: 'Select statuses to filter',
          });
          if (selectedStatuses) {
            await c.backlogIssuesProvider.filterByStatus(selectedStatuses);
          }
          break;
        }
        case 'priority': {
          const priorityOptions = ['High', 'Medium', 'Low', '高', '中', '低'];
          const selectedPriorities = await vscode.window.showQuickPick(priorityOptions, {
            canPickMany: true,
            placeHolder: 'Select priorities to filter',
          });
          if (selectedPriorities) {
            await c.backlogIssuesProvider.filterByPriority(selectedPriorities);
          }
          break;
        }
        case 'assignee': {
          const assigneeInput = await vscode.window.showInputBox({
            prompt: 'Enter assignee names (comma-separated)',
            placeHolder: 'e.g., John Doe, Jane Smith, or "Unassigned"',
          });
          if (assigneeInput) {
            const assignees = assigneeInput.split(',').map((a) => a.trim());
            await c.backlogIssuesProvider.filterByAssignee(assignees);
          }
          break;
        }
        case 'clear':
          c.backlogIssuesProvider.clearFilters();
          break;
      }
    }),

    vscode.commands.registerCommand('nulab.sort', async () => {
      const sortOptions = [
        { label: 'Updated Date (Newest First)', value: 'updated-desc' },
        { label: 'Updated Date (Oldest First)', value: 'updated-asc' },
        { label: 'Created Date (Newest First)', value: 'created-desc' },
        { label: 'Created Date (Oldest First)', value: 'created-asc' },
        { label: 'Priority (High to Low)', value: 'priority-desc' },
        { label: 'Priority (Low to High)', value: 'priority-asc' },
        { label: 'Status (A-Z)', value: 'status-asc' },
        { label: 'Status (Z-A)', value: 'status-desc' },
        { label: 'Summary (A-Z)', value: 'summary-asc' },
        { label: 'Summary (Z-A)', value: 'summary-desc' },
      ];

      const selected = await vscode.window.showQuickPick(sortOptions, {
        placeHolder: 'Select sort order',
      });

      if (selected) {
        const [sortBy, order] = selected.value.split('-') as [
          'updated' | 'created' | 'priority' | 'status' | 'summary',
          'asc' | 'desc'
        ];
        await c.backlogTreeViewProvider.sort(sortBy, order);
      }
    }),

    vscode.commands.registerCommand('nulab.clearFilters', () => {
      c.backlogIssuesProvider.clearFilters();
      c.backlogTreeViewProvider.clearFilters();
    }),
  ];
}
