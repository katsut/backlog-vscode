import * as fs from 'fs';
import * as path from 'path';
import { BacklogApiService } from '../backlogApi';
import { SlackApiService } from '../slackApi';
import { WorkspaceTodoItem, SlackMessage, BacklogParticipant } from '../../types/workspace';
import { SessionFileService, SessionAction, TodoSessionMeta } from './sessionFileService';
import { SessionContextBuilder } from './sessionContextBuilder';

/**
 * Handles TODO loading, creation, and migration from session files.
 */
export class TodoPersistenceService {
  constructor(
    private fileService: SessionFileService,
    private contextBuilder: SessionContextBuilder,
    private backlogApi: BacklogApiService | null,
    private slackApi: SlackApiService | null
  ) {}

  setApis(backlogApi: BacklogApiService | null, slackApi: SlackApiService | null): void {
    this.backlogApi = backlogApi;
    this.slackApi = slackApi;
  }

  loadAllTodos(): WorkspaceTodoItem[] {
    const todosDir = this.fileService.getTodosDir();
    if (!todosDir || !fs.existsSync(todosDir)) {
      return [];
    }
    const files = fs
      .readdirSync(todosDir)
      .filter((f) => f.startsWith('todo-') && f.endsWith('.todomd'));
    const todos: WorkspaceTodoItem[] = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(todosDir, file), 'utf-8');
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
        if (!fmMatch) {
          continue;
        }
        const meta = this.fileService.parseYaml(fmMatch[1]) as unknown as TodoSessionMeta;
        if (meta.type !== 'todo-session' || !meta.id) {
          continue;
        }
        todos.push(this.fileService.metaToTodo(meta));
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
      contextSection = this.contextBuilder.buildLightBacklogContext(ctx);
    } else if (ctx?.source === 'slack-mention' || ctx?.source === 'slack-search') {
      action = 'slack-reply';
      contextSection = this.contextBuilder.buildLightSlackContext(ctx);
    } else if (ctx?.source === 'google-doc') {
      action = 'investigate';
      contextSection = this.contextBuilder.buildLightGoogleDocContext(ctx);
    }

    const meta = this.fileService.todoToMeta(todo, action);
    const filePath = this.fileService.getSessionFilePath(todo.id);
    this.fileService.writeSessionFile(filePath, meta, contextSection, '');
    return filePath;
  }

  async startBacklogSession(todo: WorkspaceTodoItem): Promise<string> {
    const ctx = todo.context;
    if (!ctx?.issueKey || !this.backlogApi) {
      throw new Error('TODO に Backlog 課題情報がありません');
    }

    const issueIdOrKey = ctx.issueId || ctx.issueKey;
    const issue = await this.backlogApi.getIssue(issueIdOrKey);
    const comments = await this.backlogApi.getIssueComments(issueIdOrKey);

    // Download attachments and convert to data URLs
    const attachments = await this.downloadIssueAttachments(issueIdOrKey, issue);

    const contextSection = this.contextBuilder.buildBacklogContext(issue, comments, attachments);

    // Replace truncated comment from notification API with full text
    if (ctx.commentId) {
      const fullComment = comments.find((c) => c.id === ctx.commentId);
      if (fullComment?.content) {
        ctx.comment = fullComment.content;
      }
    }

    // Extract participants from issue + comments
    const participants = this.extractParticipants(issue, comments);

    const filePath = this.fileService.getSessionFilePath(todo.id);
    const existingDraft = this.fileService.getDraftContent(filePath);
    const meta = this.fileService.todoToMeta(todo, 'backlog-reply');
    meta.sessionStatus = 'draft';
    meta.contextFull = true;
    this.fileService.writeSessionFile(filePath, meta, contextSection, existingDraft, participants);
    return filePath;
  }

  private async downloadIssueAttachments(
    issueIdOrKey: string | number,
    issue: any
  ): Promise<Array<{ id: number; name: string; dataUrl: string }>> {
    const attachments: Array<{ id: number; name: string; dataUrl: string }> = [];

    if (!this.backlogApi || !issue.attachments || issue.attachments.length === 0) {
      return attachments;
    }

    for (const att of issue.attachments) {
      try {
        const buffer = await this.backlogApi.downloadIssueAttachment(issueIdOrKey, att.id);
        const mime = this.detectMimeFromName(att.name);
        const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
        attachments.push({ id: att.id, name: att.name, dataUrl });
      } catch (error) {
        console.error(`Failed to download attachment ${att.name}:`, error);
      }
    }

    return attachments;
  }

  private detectMimeFromName(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop();
    const mimeMap: { [key: string]: string } = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      webp: 'image/webp',
      pdf: 'application/pdf',
    };
    return mimeMap[ext || ''] || 'application/octet-stream';
  }

  private extractParticipants(issue: any, comments: any[]): BacklogParticipant[] {
    const seen = new Map<number, BacklogParticipant>();
    const add = (u: any) => {
      if (u?.id && u?.userId && !seen.has(u.id)) {
        seen.set(u.id, { id: u.id, userId: u.userId, name: u.name || u.userId });
      }
    };
    add(issue.createdUser);
    add(issue.assignee);
    for (const c of comments) {
      add(c.createdUser);
    }
    return Array.from(seen.values());
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
    const contextSection = this.contextBuilder.buildSlackContext(ctx.slackChannel, messages);

    const filePath = this.fileService.getSessionFilePath(todo.id);
    const existingDraft = this.fileService.getDraftContent(filePath);
    const meta = this.fileService.todoToMeta(todo, 'slack-reply');
    meta.sessionStatus = 'draft';
    meta.contextFull = true;
    this.fileService.writeSessionFile(filePath, meta, contextSection, existingDraft);
    return filePath;
  }

  startGoogleDocSession(todo: WorkspaceTodoItem, gdocContent: string): string {
    const ctx = todo.context;
    if (!ctx || ctx.source !== 'google-doc') {
      throw new Error('TODO に Google Doc 情報がありません');
    }

    const contextSection = this.contextBuilder.buildGoogleDocContext(ctx, gdocContent);

    const filePath = this.fileService.getSessionFilePath(todo.id);
    const existingDraft = this.fileService.getDraftContent(filePath);
    const meta = this.fileService.todoToMeta(todo, 'investigate');
    meta.sessionStatus = 'draft';
    meta.contextFull = true;
    this.fileService.writeSessionFile(filePath, meta, contextSection, existingDraft);
    return filePath;
  }

  // ---- Migration ----

  migrateFromTodosJson(): void {
    const nulabDir = this.fileService.getNulabDir();
    if (!nulabDir) {
      return;
    }
    const todosJsonPath = path.join(nulabDir, 'todos.json');
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
        if (this.fileService.hasSession(item.id)) {
          continue;
        }
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

  migrateMdToTodomd(): void {
    const todosDir = this.fileService.getTodosDir();
    if (!todosDir || !fs.existsSync(todosDir)) {
      return;
    }
    try {
      const mdFiles = fs
        .readdirSync(todosDir)
        .filter((f) => f.startsWith('todo-') && f.endsWith('.md'));
      for (const file of mdFiles) {
        const oldPath = path.join(todosDir, file);
        const newPath = oldPath.replace(/\.md$/, '.todomd');
        fs.renameSync(oldPath, newPath);
      }
    } catch {
      // migration failed — don't block startup
    }
  }
}
