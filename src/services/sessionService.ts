import * as fs from 'fs';
import * as path from 'path';
import { Entity } from 'backlog-js';
import { BacklogApiService } from './backlogApi';
import { SlackApiService } from './slackApi';
import { WorkspaceTodoItem, TodoContext, TodoStatus, SlackMessage } from '../types/workspace';

export type SessionAction = 'backlog-reply' | 'slack-reply' | 'investigate' | 'none';
export type SessionStatus = 'draft' | 'posted' | 'none';

/**
 * Flattened frontmatter for a session file.
 * Merges WorkspaceTodoItem + TodoContext + session-specific fields.
 */
export interface TodoSessionMeta {
  type: 'todo-session';
  // WorkspaceTodoItem fields
  id: string;
  text: string;
  status: TodoStatus;
  order: number;
  createdAt: string;
  completedAt?: string;
  notes?: string;
  replied?: boolean;
  repliedAt?: string;
  // TodoContext fields (flattened)
  source?: string;
  issueKey?: string;
  issueId?: number;
  issueSummary?: string;
  notificationId?: number;
  sender?: string;
  reason?: string;
  comment?: string;
  slackChannel?: string;
  slackThreadTs?: string;
  slackMessageTs?: string;
  slackUserName?: string;
  slackText?: string;
  // Session-specific
  action: SessionAction;
  sessionStatus: SessionStatus;
}

export class SessionService {
  private todosDir: string | undefined;
  private backlogApi: BacklogApiService | null;
  private slackApi: SlackApiService | null;

  constructor(
    backlogApi: BacklogApiService | null,
    slackApi: SlackApiService | null,
    private nulabDir: string | undefined
  ) {
    this.backlogApi = backlogApi;
    this.slackApi = slackApi;
    if (nulabDir) {
      this.todosDir = path.join(nulabDir, 'todos');
    }
  }

  setApis(backlogApi: BacklogApiService, slackApi: SlackApiService | null): void {
    this.backlogApi = backlogApi;
    this.slackApi = slackApi;
  }

  private ensureSessionsDir(): string {
    if (!this.todosDir) {
      throw new Error('ワークスペースフォルダが見つかりません');
    }
    if (!fs.existsSync(this.todosDir)) {
      fs.mkdirSync(this.todosDir, { recursive: true });
    }
    return this.todosDir;
  }

  getSessionFilePath(todoId: string): string {
    return path.join(this.ensureSessionsDir(), `todo-${todoId}.todomd`);
  }

  isSessionFile(filePath: string): boolean {
    if (!this.todosDir) {
      return false;
    }
    return (
      filePath.startsWith(this.todosDir) &&
      path.basename(filePath).startsWith('todo-') &&
      filePath.endsWith('.todomd')
    );
  }

  // ---- TODO Persistence (Single Source of Truth) ----

  loadAllTodos(): WorkspaceTodoItem[] {
    if (!this.todosDir || !fs.existsSync(this.todosDir)) {
      return [];
    }
    const files = fs
      .readdirSync(this.todosDir)
      .filter((f) => f.startsWith('todo-') && f.endsWith('.todomd'));
    const todos: WorkspaceTodoItem[] = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(this.todosDir, file), 'utf-8');
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!fmMatch) {
          continue;
        }
        const meta = this.parseYaml(fmMatch[1]) as unknown as TodoSessionMeta;
        if (meta.type !== 'todo-session' || !meta.id) {
          continue;
        }
        todos.push(this.metaToTodo(meta));
      } catch {
        // skip unreadable files
      }
    }
    return todos.sort((a, b) => a.order - b.order);
  }

  createSessionFromTodo(todo: WorkspaceTodoItem): string {
    const ctx = todo.context;
    let action: SessionAction = 'none';
    let contextSection = '';

    if (ctx?.source === 'backlog-notification' && ctx.issueKey) {
      action = 'backlog-reply';
      contextSection = this.buildLightBacklogContext(ctx);
    } else if (ctx?.source === 'slack-mention' || ctx?.source === 'slack-search') {
      action = 'slack-reply';
      contextSection = this.buildLightSlackContext(ctx);
    }

    const meta = this.todoToMeta(todo, action);
    const filePath = this.getSessionFilePath(todo.id);
    this.writeSessionFile(filePath, meta, contextSection, '');
    return filePath;
  }

  updateFrontmatter(todoId: string, updates: Partial<TodoSessionMeta>): void {
    const filePath = this.getSessionFilePath(todoId);
    if (!fs.existsSync(filePath)) {
      return;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      return;
    }
    const meta = this.parseYaml(fmMatch[1]) as Record<string, unknown>;
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) {
        delete meta[key];
      } else {
        meta[key] = value;
      }
    }
    const newFrontmatter = this.toYaml(meta);
    const rest = content.slice(fmMatch[0].length);
    fs.writeFileSync(filePath, `---\n${newFrontmatter}\n---${rest}`, 'utf-8');
  }

  deleteTodoFile(todoId: string): void {
    try {
      const filePath = this.getSessionFilePath(todoId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // ignore
    }
  }

  clearDraft(todoId: string): void {
    const filePath = this.getSessionFilePath(todoId);
    if (!fs.existsSync(filePath)) {
      return;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const draftMarker = '<!-- DRAFT -->';
    const draftIdx = content.indexOf(draftMarker);
    if (draftIdx >= 0) {
      const before = content.slice(0, draftIdx + draftMarker.length);
      fs.writeFileSync(filePath, before + '\n', 'utf-8');
    }
    this.updateFrontmatter(todoId, { sessionStatus: 'none' });
  }

  hasSession(todoId: string): boolean {
    try {
      return fs.existsSync(this.getSessionFilePath(todoId));
    } catch {
      return false;
    }
  }

  // ---- Active session marker ----

  setActiveSession(todoId: string): void {
    const activePath = path.join(this.ensureSessionsDir(), '.active');
    fs.writeFileSync(activePath, todoId, 'utf-8');
  }

  // ---- Migration ----

  migrateFromTodosJson(): void {
    if (!this.nulabDir) {
      return;
    }
    const todosJsonPath = path.join(this.nulabDir, 'todos.json');
    if (!fs.existsSync(todosJsonPath)) {
      return;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(todosJsonPath, 'utf-8'));
      if (!Array.isArray(raw) || raw.length === 0) {
        fs.renameSync(todosJsonPath, todosJsonPath + '.bak');
        return;
      }

      for (const item of raw) {
        if (!item.id) {
          continue;
        }
        // Skip if session file already exists
        if (this.hasSession(item.id)) {
          continue;
        }
        // Legacy migration: completed → status
        if (!item.status) {
          item.status = item.completed ? 'done' : 'open';
        }
        this.createSessionFromTodo(item as WorkspaceTodoItem);
      }

      fs.renameSync(todosJsonPath, todosJsonPath + '.bak');
    } catch {
      // migration failed — don't block startup
    }
  }

  /** Rename legacy .md files to .todomd */
  migrateMdToTodomd(): void {
    if (!this.todosDir || !fs.existsSync(this.todosDir)) {
      return;
    }
    try {
      const mdFiles = fs
        .readdirSync(this.todosDir)
        .filter((f) => f.startsWith('todo-') && f.endsWith('.md'));
      for (const file of mdFiles) {
        const oldPath = path.join(this.todosDir, file);
        const newPath = oldPath.replace(/\.md$/, '.todomd');
        fs.renameSync(oldPath, newPath);
      }
    } catch {
      // migration failed — don't block startup
    }
  }

  // ---- Session creation (full — with API calls) ----

  async startBacklogSession(todo: WorkspaceTodoItem): Promise<string> {
    const ctx = todo.context;
    if (!ctx?.issueKey || !ctx.issueId || !this.backlogApi) {
      throw new Error('TODO に Backlog 課題情報がありません');
    }

    const issue = await this.backlogApi.getIssue(ctx.issueId);
    const comments = await this.backlogApi.getIssueComments(ctx.issueId);
    const contextSection = this.buildBacklogContext(issue, comments);

    // Rewrite the session file with full context
    const filePath = this.getSessionFilePath(todo.id);
    const existingDraft = this.getDraftContent(filePath);
    const meta = this.todoToMeta(todo, 'backlog-reply');
    meta.sessionStatus = 'draft';
    this.writeSessionFile(filePath, meta, contextSection, existingDraft);
    return filePath;
  }

  async startSlackSession(todo: WorkspaceTodoItem): Promise<string> {
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

    const filePath = this.getSessionFilePath(todo.id);
    const existingDraft = this.getDraftContent(filePath);
    const meta = this.todoToMeta(todo, 'slack-reply');
    meta.sessionStatus = 'draft';
    this.writeSessionFile(filePath, meta, contextSection, existingDraft);
    return filePath;
  }

  // ---- Draft info ----

  getDraftInfo(
    todoId: string
  ): { content: string; action: SessionAction; status: SessionStatus } | null {
    try {
      const filePath = this.getSessionFilePath(todoId);
      const parsed = this.parseSession(filePath);
      if (!parsed) {
        return null;
      }
      // No draft info if: manual TODO, or draft content is empty
      if (parsed.meta.action === 'none') {
        return null;
      }
      if (!parsed.draft.trim()) {
        return null;
      }
      return {
        content: parsed.draft,
        action: parsed.meta.action,
        status: parsed.meta.sessionStatus,
      };
    } catch {
      return null;
    }
  }

  // ---- Parse ----

  parseSession(filePath: string): { meta: TodoSessionMeta; draft: string } | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.parseSessionContent(content);
    } catch {
      return null;
    }
  }

  private parseSessionContent(content: string): { meta: TodoSessionMeta; draft: string } | null {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      return null;
    }

    const meta = this.parseYaml(fmMatch[1]) as unknown as TodoSessionMeta;
    if (meta.type !== 'todo-session') {
      return null;
    }

    const draftMarker = '<!-- DRAFT -->';
    const draftIdx = content.indexOf(draftMarker);
    let draft = '';
    if (draftIdx >= 0) {
      draft = content.slice(draftIdx + draftMarker.length).trim();
    }

    return { meta, draft };
  }

  private getDraftContent(filePath: string): string {
    const parsed = this.parseSession(filePath);
    return parsed?.draft || '';
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
    if (parsed.meta.sessionStatus === 'posted') {
      throw new Error('すでに投稿済みです');
    }
    if (!parsed.meta.issueKey || !this.backlogApi) {
      throw new Error('課題キーがありません');
    }

    await this.backlogApi.postIssueComment(parsed.meta.issueKey, {
      content: parsed.draft.trim(),
    });

    this.updateFrontmatter(parsed.meta.id, { sessionStatus: 'posted' });
  }

  async postSlackReply(filePath: string): Promise<void> {
    const parsed = this.parseSession(filePath);
    if (!parsed) {
      throw new Error('セッションファイルを読み取れません');
    }
    if (!parsed.draft.trim()) {
      throw new Error('返信内容が空です');
    }
    if (parsed.meta.sessionStatus === 'posted') {
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

    this.updateFrontmatter(parsed.meta.id, { sessionStatus: 'posted' });
  }

  // ---- Conversion helpers ----

  private todoToMeta(todo: WorkspaceTodoItem, action: SessionAction): TodoSessionMeta {
    const ctx = todo.context;
    return {
      type: 'todo-session',
      id: todo.id,
      text: todo.text,
      status: todo.status,
      order: todo.order,
      createdAt: todo.createdAt,
      completedAt: todo.completedAt,
      notes: todo.notes,
      replied: todo.replied,
      repliedAt: todo.repliedAt,
      source: ctx?.source,
      issueKey: ctx?.issueKey,
      issueId: ctx?.issueId,
      issueSummary: ctx?.issueSummary,
      notificationId: ctx?.notificationId,
      sender: ctx?.sender,
      reason: ctx?.reason,
      comment: ctx?.comment,
      slackChannel: ctx?.slackChannel,
      slackThreadTs: ctx?.slackThreadTs,
      slackMessageTs: ctx?.slackMessageTs,
      slackUserName: ctx?.slackUserName,
      slackText: ctx?.slackText,
      action,
      sessionStatus: action === 'none' ? 'none' : 'draft',
    };
  }

  private metaToTodo(meta: TodoSessionMeta): WorkspaceTodoItem {
    const item: WorkspaceTodoItem = {
      id: meta.id,
      text: meta.text || '',
      status: meta.status || 'open',
      order: meta.order ?? 0,
      createdAt: meta.createdAt || new Date().toISOString(),
      completedAt: meta.completedAt || undefined,
      notes: meta.notes || undefined,
      replied: meta.replied || undefined,
      repliedAt: meta.repliedAt || undefined,
    };

    // Reconstruct nested context if source exists
    if (meta.source) {
      const context: TodoContext = {
        source: meta.source as TodoContext['source'],
        issueKey: meta.issueKey,
        issueId: meta.issueId,
        issueSummary: meta.issueSummary,
        notificationId: meta.notificationId,
        sender: meta.sender,
        reason: meta.reason,
        comment: meta.comment,
        slackChannel: meta.slackChannel,
        slackThreadTs: meta.slackThreadTs,
        slackMessageTs: meta.slackMessageTs,
        slackUserName: meta.slackUserName,
        slackText: meta.slackText,
      };
      item.context = context;
    }

    return item;
  }

  // ---- Context builders (light — no API calls) ----

  private buildLightBacklogContext(ctx: TodoContext): string {
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

  private buildLightSlackContext(ctx: TodoContext): string {
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

  // ---- Context builders (full — with API data) ----

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

  // ---- File I/O ----

  private writeSessionFile(
    filePath: string,
    meta: TodoSessionMeta,
    contextSection: string,
    draft: string
  ): void {
    const frontmatter = this.toYaml(meta as unknown as Record<string, unknown>);
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

  private toYaml(meta: Record<string, unknown>): string {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(meta)) {
      if (value === undefined || value === null) {
        continue;
      }
      if (typeof value === 'boolean') {
        lines.push(`${key}: ${value}`);
      } else if (typeof value === 'number') {
        lines.push(`${key}: ${value}`);
      } else if (typeof value === 'string') {
        // Escape newlines in string values
        const escaped = value.replace(/\n/g, '\\n');
        if (escaped.includes(':') || escaped.includes('"') || escaped.includes('\\n')) {
          lines.push(`${key}: "${escaped}"`);
        } else {
          lines.push(`${key}: ${escaped}`);
        }
      }
    }
    return lines.join('\n');
  }

  private parseYaml(yaml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const line of yaml.split('\n')) {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) {
        let value: unknown = match[2].trim();
        if (value === '' || value === '""') {
          // Skip empty values
          continue;
        }
        // Remove surrounding quotes
        if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        // Unescape newlines
        if (typeof value === 'string') {
          value = (value as string).replace(/\\n/g, '\n');
        }
        // Parse booleans
        if (value === 'true') {
          value = true;
        } else if (value === 'false') {
          value = false;
        }
        // Parse integers
        if (typeof value === 'string' && /^\d+$/.test(value)) {
          value = parseInt(value, 10);
        }
        result[match[1]] = value;
      }
    }
    return result;
  }
}
