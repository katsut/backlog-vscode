import * as fs from 'fs';
import * as path from 'path';
import {
  WorkspaceTodoItem,
  TodoContext,
  TodoStatus,
  BacklogParticipant,
} from '../../types/workspace';

export type SessionAction = 'backlog-reply' | 'slack-reply' | 'investigate' | 'none';
export type SessionStatus = 'draft' | 'posted' | 'none';

export interface TodoSessionMeta {
  type: 'todo-session';
  id: string;
  text: string;
  status: TodoStatus;
  order: number;
  createdAt: string;
  completedAt?: string;
  notes?: string;
  replied?: boolean;
  repliedAt?: string;
  source?: string;
  issueKey?: string;
  issueId?: number;
  issueSummary?: string;
  notificationId?: number;
  commentId?: number;
  sender?: string;
  senderId?: number;
  senderUserId?: string;
  reason?: string;
  comment?: string;
  slackChannel?: string;
  slackThreadTs?: string;
  slackMessageTs?: string;
  slackUserName?: string;
  slackText?: string;
  action: SessionAction;
  sessionStatus: SessionStatus;
  contextFull?: boolean;
}

/**
 * Handles session file CRUD, YAML frontmatter parsing/serialization,
 * and conversion between TodoSessionMeta and WorkspaceTodoItem.
 */
export class SessionFileService {
  private todosDir: string | undefined;

  constructor(private nulabDir: string | undefined) {
    if (nulabDir) {
      this.todosDir = path.join(nulabDir, 'todos');
    }
  }

  getTodosDir(): string | undefined {
    return this.todosDir;
  }

  getNulabDir(): string | undefined {
    return this.nulabDir;
  }

  ensureSessionsDir(): string {
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

  hasSession(todoId: string): boolean {
    try {
      return fs.existsSync(this.getSessionFilePath(todoId));
    } catch {
      return false;
    }
  }

  setActiveSession(todoId: string): void {
    const activePath = path.join(this.ensureSessionsDir(), '.active');
    fs.writeFileSync(activePath, todoId, 'utf-8');
  }

  writeSessionFile(
    filePath: string,
    meta: TodoSessionMeta,
    contextSection: string,
    draft: string,
    participants?: BacklogParticipant[]
  ): void {
    const frontmatter = this.toYaml(meta as unknown as Record<string, unknown>);
    const instruction = this.buildInstruction(meta.action);
    const content = [
      '---',
      frontmatter,
      '---',
      '',
      ...(instruction ? [instruction, ''] : []),
      '<!-- CONTEXT (この部分は編集しないでください) -->',
      contextSection,
      '<!-- /CONTEXT -->',
      '',
      ...(participants && participants.length > 0
        ? [`<!-- PARTICIPANTS ${JSON.stringify(participants)} -->`, '']
        : []),
      '<!-- DRAFT -->',
      draft,
      '',
    ].join('\n');

    fs.writeFileSync(filePath, content, 'utf-8');
  }

  getParticipants(todoId: string): BacklogParticipant[] {
    try {
      const filePath = this.getSessionFilePath(todoId);
      const content = fs.readFileSync(filePath, 'utf-8');
      const match = content.match(/<!-- PARTICIPANTS (.+?) -->/);
      if (match) {
        return JSON.parse(match[1]);
      }
    } catch {
      // ignore
    }
    return [];
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
    const draftIdx = content.lastIndexOf(draftMarker);
    if (draftIdx >= 0) {
      const before = content.slice(0, draftIdx + draftMarker.length);
      fs.writeFileSync(filePath, before + '\n', 'utf-8');
    }
    this.updateFrontmatter(todoId, { sessionStatus: 'none' });
  }

  parseSession(filePath: string): { meta: TodoSessionMeta; draft: string } | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.parseSessionContent(content);
    } catch {
      return null;
    }
  }

  getDraftInfo(
    todoId: string
  ): { content: string; action: SessionAction; status: SessionStatus } | null {
    try {
      const filePath = this.getSessionFilePath(todoId);
      const parsed = this.parseSession(filePath);
      if (!parsed) {
        return null;
      }
      if (parsed.meta.action === 'none') {
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

  getDraftContent(filePath: string): string {
    const parsed = this.parseSession(filePath);
    return parsed?.draft || '';
  }

  getContextSection(todoId: string): string {
    try {
      const filePath = this.getSessionFilePath(todoId);
      const content = fs.readFileSync(filePath, 'utf-8');
      const startMarker = '<!-- CONTEXT (この部分は編集しないでください) -->';
      const endMarker = '<!-- /CONTEXT -->';
      const startIdx = content.indexOf(startMarker);
      const endIdx = content.indexOf(endMarker);
      if (startIdx >= 0 && endIdx > startIdx) {
        return content.slice(startIdx + startMarker.length, endIdx).trim();
      }
    } catch {
      // ignore
    }
    return '';
  }

  // ---- Conversion helpers ----

  todoToMeta(todo: WorkspaceTodoItem, action: SessionAction): TodoSessionMeta {
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
      commentId: ctx?.commentId,
      sender: ctx?.sender,
      senderId: ctx?.senderId,
      senderUserId: ctx?.senderUserId,
      reason: ctx?.reason,
      comment: ctx?.comment,
      slackChannel: ctx?.slackChannel,
      slackThreadTs: ctx?.slackThreadTs || ctx?.slackMessageTs,
      slackMessageTs: ctx?.slackMessageTs,
      slackUserName: ctx?.slackUserName,
      slackText: ctx?.slackText,
      action,
      sessionStatus: action === 'none' ? 'none' : 'draft',
    };
  }

  metaToTodo(meta: TodoSessionMeta): WorkspaceTodoItem {
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

    if (meta.source) {
      const context: TodoContext = {
        source: meta.source as TodoContext['source'],
        issueKey: meta.issueKey,
        issueId: meta.issueId,
        issueSummary: meta.issueSummary,
        notificationId: meta.notificationId,
        commentId: meta.commentId,
        sender: meta.sender,
        senderId: meta.senderId,
        senderUserId: meta.senderUserId,
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

  // ---- YAML helpers ----

  private parseSessionContent(content: string): { meta: TodoSessionMeta; draft: string } | null {
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      return null;
    }

    const meta = this.parseYaml(fmMatch[1]) as unknown as TodoSessionMeta;
    if (meta.type !== 'todo-session') {
      return null;
    }

    // Normalize: DM messages may lack slackThreadTs
    if (!meta.slackThreadTs && meta.slackMessageTs) {
      meta.slackThreadTs = meta.slackMessageTs;
    }

    const draftMarker = '<!-- DRAFT -->';
    const draftIdx = content.lastIndexOf(draftMarker);
    let draft = '';
    if (draftIdx >= 0) {
      draft = content.slice(draftIdx + draftMarker.length).trim();
    }

    return { meta, draft };
  }

  parseYaml(yaml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const line of yaml.split('\n')) {
      const match = line.match(/^(\w+):\s*(.*)$/);
      if (match) {
        let value: unknown = match[2].trim();
        if (value === '' || value === '""') {
          continue;
        }
        if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        if (typeof value === 'string') {
          value = (value as string).replace(/\\n/g, '\n');
        }
        if (value === 'true') {
          value = true;
        } else if (value === 'false') {
          value = false;
        }
        if (typeof value === 'string' && /^\d+$/.test(value)) {
          value = parseInt(value, 10);
        }
        result[match[1]] = value;
      }
    }
    return result;
  }

  private buildInstruction(action: SessionAction): string {
    if (action === 'slack-reply') {
      return [
        '<!-- INSTRUCTION',
        'このファイルは VSCode 拡張が自動生成した Slack 返信用セッションファイルです。',
        '',
        '■ あなたのタスク:',
        '1. CONTEXT セクションの Slack メッセージを読む',
        '2. ユーザーの指示に従い、DRAFT セクションに返信テキストを書く',
        '3. Edit ツールでファイル末尾の DRAFT セクションに返信内容を追記する',
        '',
        '■ ルール:',
        '- ユーザーが「〇〇で」「〇〇と返して」と言ったら、その内容をそのまま DRAFT に書く',
        '- 相手のトーンに合わせた自然な日本語にする',
        '- 英語で返信する場合は、基本的な文法と簡単な単語を使い、短い文で書く（中学英語レベル）',
        '- Slack 絵文字 (:emoji_name:) を適宜使う',
        '- CONTEXT セクションと INSTRUCTION セクションは編集しない',
        '- 返信内容だけを書く（「了解しました」等の説明は不要）',
        '/INSTRUCTION -->',
      ].join('\n');
    }
    if (action === 'backlog-reply') {
      return [
        '<!-- INSTRUCTION',
        'このファイルは VSCode 拡張が自動生成した Backlog コメント用セッションファイルです。',
        '',
        '■ あなたのタスク:',
        '1. CONTEXT セクションの課題・コメントを読む',
        '2. ユーザーの指示に従い、DRAFT セクションにコメントを書く',
        '3. Edit ツールでファイル末尾の DRAFT セクションにコメント内容を追記する',
        '',
        '■ ルール:',
        '- ユーザーが「〇〇で」「〇〇と返して」と言ったら、その内容をそのまま DRAFT に書く',
        '- 課題の文脈を踏まえた回答にする',
        '- 英語で返信する場合は、基本的な文法と簡単な単語を使い、短い文で書く（中学英語レベル）',
        '- Backlog 記法 (Markdown) が使える',
        '- メンション: 相手に通知したい場合は @名前 または @ユーザーID で書く（投稿時に自動的に Backlog メンション形式に変換される）',
        '- CONTEXT セクションと INSTRUCTION セクションは編集しない',
        '- コメント内容だけを書く（説明は不要）',
        '/INSTRUCTION -->',
      ].join('\n');
    }
    return '';
  }

  toYaml(meta: Record<string, unknown>): string {
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
}
