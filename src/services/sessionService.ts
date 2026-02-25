import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Entity } from 'backlog-js';
import { BacklogApiService } from './backlogApi';
import { SlackApiService } from './slackApi';
import { AnthropicService } from './anthropicService';
import { WorkspaceTodoItem, SlackMessage } from '../types/workspace';

export type SessionAction = 'backlog-reply' | 'slack-reply' | 'investigate';
export type SessionStatus = 'draft' | 'generating' | 'posted';

export interface SessionMeta {
  type: 'todo-session';
  todoId: string;
  action: SessionAction;
  status: SessionStatus;
  createdAt: string;
  // Backlog
  issueKey?: string;
  issueId?: number;
  // Slack
  slackChannel?: string;
  slackThreadTs?: string;
}

export class SessionService {
  private sessionsDir: string | undefined;

  constructor(
    private backlogApi: BacklogApiService,
    private slackApi: SlackApiService | null,
    private anthropicService: AnthropicService,
    private nulabDir: string | undefined
  ) {
    if (nulabDir) {
      this.sessionsDir = path.join(nulabDir, 'sessions');
    }
  }

  private ensureSessionsDir(): string {
    if (!this.sessionsDir) {
      throw new Error('ワークスペースフォルダが見つかりません');
    }
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
    return this.sessionsDir;
  }

  getSessionFilePath(todoId: string): string {
    return path.join(this.ensureSessionsDir(), `todo-${todoId}.md`);
  }

  isSessionFile(filePath: string): boolean {
    if (!this.sessionsDir) {
      return false;
    }
    return (
      filePath.startsWith(this.sessionsDir) &&
      path.basename(filePath).startsWith('todo-') &&
      filePath.endsWith('.md')
    );
  }

  // ---- Session generation ----

  async startBacklogSession(
    todo: WorkspaceTodoItem,
    onChunk: (text: string) => void,
    token?: vscode.CancellationToken
  ): Promise<string> {
    const ctx = todo.context;
    if (!ctx?.issueKey || !ctx.issueId) {
      throw new Error('TODO に Backlog 課題情報がありません');
    }

    const issue = await this.backlogApi.getIssue(ctx.issueId);
    const comments = await this.backlogApi.getIssueComments(ctx.issueId);

    const contextSection = this.buildBacklogContext(issue, comments);
    const meta: SessionMeta = {
      type: 'todo-session',
      todoId: todo.id,
      action: 'backlog-reply',
      status: 'generating',
      createdAt: new Date().toISOString(),
      issueKey: ctx.issueKey,
      issueId: ctx.issueId,
    };

    const filePath = this.getSessionFilePath(todo.id);
    this.writeSessionFile(filePath, meta, contextSection, '');

    // Open in editor
    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);

    // Stream AI draft
    let draft = '';
    try {
      draft = await this.anthropicService.generateReplyDraft(
        contextSection,
        'backlog-reply',
        (chunk) => {
          draft += chunk;
          this.updateDraftSection(filePath, meta, contextSection, draft);
          onChunk(chunk);
        },
        token
      );
    } catch (err) {
      if ((err as Error).message !== 'Cancelled') {
        throw err;
      }
    }

    // Final write with status: draft
    meta.status = 'draft';
    this.writeSessionFile(filePath, meta, contextSection, draft);
    return filePath;
  }

  async startSlackSession(
    todo: WorkspaceTodoItem,
    onChunk: (text: string) => void,
    token?: vscode.CancellationToken
  ): Promise<string> {
    const ctx = todo.context;
    if (!ctx?.slackChannel) {
      throw new Error('TODO に Slack チャンネル情報がありません');
    }

    const threadTs = ctx.slackThreadTs || ctx.slackMessageTs || '';
    let messages: SlackMessage[] = [];
    if (this.slackApi && threadTs) {
      messages = await this.slackApi.getThreadMessages(ctx.slackChannel, threadTs);
    }

    const contextSection = this.buildSlackContext(ctx.slackChannel, messages);
    const meta: SessionMeta = {
      type: 'todo-session',
      todoId: todo.id,
      action: 'slack-reply',
      status: 'generating',
      createdAt: new Date().toISOString(),
      slackChannel: ctx.slackChannel,
      slackThreadTs: threadTs,
    };

    const filePath = this.getSessionFilePath(todo.id);
    this.writeSessionFile(filePath, meta, contextSection, '');

    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);

    let draft = '';
    try {
      draft = await this.anthropicService.generateReplyDraft(
        contextSection,
        'slack-reply',
        (chunk) => {
          draft += chunk;
          this.updateDraftSection(filePath, meta, contextSection, draft);
          onChunk(chunk);
        },
        token
      );
    } catch (err) {
      if ((err as Error).message !== 'Cancelled') {
        throw err;
      }
    }

    meta.status = 'draft';
    this.writeSessionFile(filePath, meta, contextSection, draft);
    return filePath;
  }

  // ---- Parse ----

  parseSession(filePath: string): { meta: SessionMeta; draft: string } | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.parseSessionContent(content);
    } catch {
      return null;
    }
  }

  private parseSessionContent(content: string): { meta: SessionMeta; draft: string } | null {
    // Extract YAML frontmatter
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      return null;
    }

    const meta = this.parseYaml(fmMatch[1]) as unknown as SessionMeta;
    if (meta.type !== 'todo-session') {
      return null;
    }

    // Extract draft (everything after <!-- DRAFT -->)
    const draftMarker = '<!-- DRAFT -->';
    const draftIdx = content.indexOf(draftMarker);
    let draft = '';
    if (draftIdx >= 0) {
      draft = content.slice(draftIdx + draftMarker.length).trim();
    }

    return { meta, draft };
  }

  // ---- Post ----

  async postBacklogReply(filePath: string): Promise<void> {
    const parsed = this.parseSession(filePath);
    if (!parsed) {
      throw new Error('セッションファイルを読み取れません');
    }
    if (!parsed.draft.trim()) {
      throw new Error('返信内容が空です');
    }
    if (parsed.meta.status === 'posted') {
      throw new Error('すでに投稿済みです');
    }
    if (!parsed.meta.issueKey) {
      throw new Error('課題キーがありません');
    }

    await this.backlogApi.postIssueComment(parsed.meta.issueKey, {
      content: parsed.draft.trim(),
    });

    this.updateStatus(filePath, 'posted');
  }

  async postSlackReply(filePath: string): Promise<void> {
    const parsed = this.parseSession(filePath);
    if (!parsed) {
      throw new Error('セッションファイルを読み取れません');
    }
    if (!parsed.draft.trim()) {
      throw new Error('返信内容が空です');
    }
    if (parsed.meta.status === 'posted') {
      throw new Error('すでに投稿済みです');
    }
    if (!parsed.meta.slackChannel || !parsed.meta.slackThreadTs) {
      throw new Error('Slack チャンネル/スレッド情報がありません');
    }
    if (!this.slackApi) {
      throw new Error('Slack が設定されていません');
    }

    await this.slackApi.postReply(
      parsed.meta.slackChannel,
      parsed.meta.slackThreadTs,
      parsed.draft.trim()
    );

    this.updateStatus(filePath, 'posted');
  }

  // ---- Helpers ----

  private buildBacklogContext(issue: Entity.Issue.Issue, comments: Entity.Issue.Comment[]): string {
    const lines: string[] = [];
    lines.push(`## 課題: ${issue.issueKey} - ${issue.summary}`);
    lines.push('');

    const status = (issue.status as { name?: string })?.name || '不明';
    const priority = (issue.priority as { name?: string })?.name || '不明';
    const assignee = (issue.assignee as { name?: string })?.name || '未割当';
    lines.push(`**ステータス:** ${status} | **優先度:** ${priority} | **担当:** ${assignee}`);
    lines.push('');

    if (issue.description) {
      const desc =
        issue.description.length > 500
          ? issue.description.slice(0, 500) + '...'
          : issue.description;
      lines.push('### 説明 (抜粋)');
      lines.push(`> ${desc.replace(/\n/g, '\n> ')}`);
      lines.push('');
    }

    // Recent comments (last 10, excluding empty / change-only)
    const regularComments = comments.filter((c) => c.content && c.content.trim() !== '').slice(-10);

    if (regularComments.length > 0) {
      lines.push('### コメントスレッド');
      lines.push('');
      for (const c of regularComments) {
        const author = (c.createdUser as { name?: string })?.name || '不明';
        const date = new Date(c.created).toLocaleDateString('ja-JP');
        lines.push(`**${author}** (${date}):`);
        lines.push(`> ${c.content.replace(/\n/g, '\n> ')}`);
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private buildSlackContext(channel: string, messages: SlackMessage[]): string {
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

  private writeSessionFile(
    filePath: string,
    meta: SessionMeta,
    contextSection: string,
    draft: string
  ): void {
    const frontmatter = this.toYaml(meta);
    const content = [
      '---',
      frontmatter,
      '---',
      '',
      '<!-- CONTEXT (この部分は編集しないでください) -->',
      contextSection,
      '<!-- /CONTEXT -->',
      '',
      '<!-- DRAFT -->',
      draft,
      '',
    ].join('\n');

    fs.writeFileSync(filePath, content, 'utf-8');
  }

  private updateDraftSection(
    filePath: string,
    meta: SessionMeta,
    contextSection: string,
    draft: string
  ): void {
    this.writeSessionFile(filePath, meta, contextSection, draft);
  }

  private updateStatus(filePath: string, status: SessionStatus): void {
    const content = fs.readFileSync(filePath, 'utf-8');
    const updated = content.replace(/^(status:\s*).+$/m, `$1${status}`);
    fs.writeFileSync(filePath, updated, 'utf-8');
  }

  private toYaml(meta: SessionMeta): string {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(meta)) {
      if (value === undefined || value === null) {
        continue;
      }
      if (typeof value === 'string' && (value.includes(':') || value.includes('"'))) {
        lines.push(`${key}: "${value}"`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    }
    return lines.join('\n');
  }

  private parseYaml(yaml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const line of yaml.split('\n')) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        let value: unknown = match[2].trim();
        // Remove surrounding quotes
        if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        // Parse numbers
        if (typeof value === 'string' && /^\d+$/.test(value)) {
          value = parseInt(value, 10);
        }
        result[match[1]] = value;
      }
    }
    return result;
  }

  cleanupSessions(): void {
    if (!this.sessionsDir || !fs.existsSync(this.sessionsDir)) {
      return;
    }
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24h

    for (const file of fs.readdirSync(this.sessionsDir)) {
      if (!file.endsWith('.md')) {
        continue;
      }
      const filePath = path.join(this.sessionsDir, file);
      const parsed = this.parseSession(filePath);
      if (parsed?.meta.status === 'posted') {
        const created = new Date(parsed.meta.createdAt).getTime();
        if (now - created > maxAge) {
          fs.unlinkSync(filePath);
        }
      }
    }
  }
}
