import { Entity } from 'backlog-js';
import { TodoContext, SlackMessage } from '../../types/workspace';

/**
 * Builds context sections for session files.
 * "Light" builders use only locally available data (no API calls).
 * "Full" builders use API-fetched data for richer context.
 */
export class SessionContextBuilder {
  // ---- Light context builders (no API calls) ----

  buildLightBacklogContext(ctx: TodoContext): string {
    const lines: string[] = [];
    lines.push(`## 課題: ${ctx.issueKey} - ${ctx.issueSummary || ''}`);
    lines.push('');
    if (ctx.sender) {
      lines.push(`**通知元:** ${ctx.sender} (${ctx.reason || ''})`);
      lines.push('');
    }
    if (ctx.comment) {
      lines.push('### 最新コメント');
      lines.push(`> ${ctx.comment.replace(/\n/g, '\n> ')}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  buildLightSlackContext(ctx: TodoContext): string {
    const lines: string[] = [];
    lines.push(`## Slack メッセージ: #${ctx.slackChannel || ''}`);
    lines.push('');
    if (ctx.slackUserName) {
      lines.push(`**From:** ${ctx.slackUserName}`);
      lines.push('');
    }
    if (ctx.slackText) {
      lines.push('### メッセージ');
      lines.push(`> ${ctx.slackText.replace(/\n/g, '\n> ')}`);
      lines.push('');
    }
    return lines.join('\n');
  }

  // ---- Full context builders (with API data) ----

  buildBacklogContext(issue: Entity.Issue.Issue, comments: Entity.Issue.Comment[]): string {
    const lines: string[] = [];
    lines.push(`## 課題: ${issue.issueKey} - ${issue.summary}`);
    lines.push('');

    // Basic info
    const issueType = (issue.issueType as { name?: string })?.name || '';
    const status = (issue.status as { name?: string })?.name || '不明';
    const priority = (issue.priority as { name?: string })?.name || '不明';
    const assignee = (issue.assignee as { name?: string })?.name || '未割当';
    const dueDate = (issue as any).dueDate || '';
    lines.push(`**種別:** ${issueType} | **ステータス:** ${status} | **優先度:** ${priority}`);
    lines.push(`**担当:** ${assignee} | **期日:** ${dueDate || 'なし'}`);

    // Milestone
    const milestones = (issue as any).milestone;
    if (Array.isArray(milestones) && milestones.length > 0) {
      const names = milestones
        .map((m: any) => m.name)
        .filter(Boolean)
        .join(', ');
      if (names) {
        lines.push(`**マイルストーン:** ${names}`);
      }
    }

    // Category
    const categories = (issue as any).category;
    if (Array.isArray(categories) && categories.length > 0) {
      const names = categories
        .map((c: any) => c.name)
        .filter(Boolean)
        .join(', ');
      if (names) {
        lines.push(`**カテゴリ:** ${names}`);
      }
    }

    lines.push('');

    if (issue.description) {
      const desc =
        issue.description.length > 2000
          ? issue.description.slice(0, 2000) + '...'
          : issue.description;
      lines.push('### 説明');
      lines.push(`> ${desc.replace(/\n/g, '\n> ')}`);
      lines.push('');
    }

    // Include last 20 comments with change logs
    const recentComments = comments.slice(-20);

    if (recentComments.length > 0) {
      lines.push('### コメント・変更履歴');
      lines.push('');
      for (const c of recentComments) {
        const author = (c.createdUser as { name?: string })?.name || '不明';
        const date = new Date(c.created).toLocaleDateString('ja-JP');

        // Format change logs
        if (c.changeLog && c.changeLog.length > 0) {
          const changes = c.changeLog
            .map((log) => {
              // Long-text fields: just note the change, don't dump full content
              if (log.field === 'description') {
                return `${log.field} を更新`;
              }
              const truncate = (s: string, max: number) =>
                s.length > max ? s.slice(0, max) + '...' : s;
              if (log.originalValue && log.newValue) {
                return `${log.field}: ${truncate(log.originalValue, 80)} → ${truncate(
                  log.newValue,
                  80
                )}`;
              } else if (log.newValue) {
                return `${log.field}: → ${truncate(log.newValue, 80)}`;
              }
              return `${log.field} を変更`;
            })
            .join(', ');
          lines.push(`**${author}** (${date}): [変更] ${changes}`);
        }

        // Format comment text
        if (c.content && c.content.trim()) {
          if (!(c.changeLog && c.changeLog.length > 0)) {
            lines.push(`**${author}** (${date}):`);
          }
          lines.push(`> ${c.content.replace(/\n/g, '\n> ')}`);
        }

        if ((c.changeLog && c.changeLog.length > 0) || (c.content && c.content.trim())) {
          lines.push('');
        }
      }
    }

    return lines.join('\n');
  }

  buildSlackContext(channel: string, messages: SlackMessage[]): string {
    const lines: string[] = [];
    lines.push(`## Slack スレッド: #${channel}`);
    lines.push('');

    for (const msg of messages) {
      const name = msg.userName || msg.user;
      const date = new Date(parseFloat(msg.ts) * 1000);
      const dateStr = date.toLocaleString('ja-JP');
      lines.push(`**${name}** (${dateStr}):`);
      lines.push(`> ${msg.text.replace(/\n/g, '\n> ')}`);
      lines.push('');
    }

    return lines.join('\n');
  }
}
