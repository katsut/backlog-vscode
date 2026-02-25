import * as vscode from 'vscode';

export function getStatusIcon(statusName: string): string {
  switch (statusName.toLowerCase()) {
    case 'open':
    case 'オープン':
      return 'circle-outline';
    case 'in progress':
    case '処理中':
      return 'sync';
    case 'resolved':
    case '解決済み':
      return 'check';
    case 'closed':
    case 'クローズ':
      return 'circle-filled';
    default:
      return 'circle-outline';
  }
}

export function getPriorityColor(priorityName: string): vscode.ThemeColor {
  switch (priorityName.toLowerCase()) {
    case 'high':
    case '高':
      return new vscode.ThemeColor('charts.red');
    case 'medium':
    case '中':
      return new vscode.ThemeColor('charts.orange');
    case 'low':
    case '低':
      return new vscode.ThemeColor('charts.green');
    default:
      return new vscode.ThemeColor('foreground');
  }
}
