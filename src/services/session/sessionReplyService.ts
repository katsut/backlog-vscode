import { BacklogApiService } from '../backlogApi';
import { SlackApiService } from '../slackApi';
import { SessionFileService } from './sessionFileService';
import { BacklogParticipant } from '../../types/workspace';

/**
 * Handles posting replies to Backlog and Slack from session drafts.
 */
export class SessionReplyService {
  constructor(
    private fileService: SessionFileService,
    private backlogApi: BacklogApiService | null,
    private slackApi: SlackApiService | null
  ) {}

  setApis(backlogApi: BacklogApiService | null, slackApi: SlackApiService | null): void {
    this.backlogApi = backlogApi;
    this.slackApi = slackApi;
  }

  async postBacklogReply(filePath: string): Promise<void> {
    const parsed = this.fileService.parseSession(filePath);
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

    // Resolve @mentions against known participants
    const participants = this.fileService.getParticipants(parsed.meta.id);
    const { content, notifiedUserIds } = this.resolveMentions(
      parsed.draft.trim(),
      participants,
      parsed.meta.senderId
    );

    await this.backlogApi.postIssueComment(parsed.meta.issueKey, {
      content,
      ...(notifiedUserIds.length > 0 ? { notifiedUserId: notifiedUserIds } : {}),
    });

    this.fileService.updateFrontmatter(parsed.meta.id, { sessionStatus: 'posted' });
  }

  /**
   * Resolve @mentions in draft text against known participants.
   * - Converts @name/@userId to Backlog inline mention format <@U{id}>
   * - Collects user IDs for notifiedUserId[] parameter
   */
  private resolveMentions(
    draft: string,
    participants: BacklogParticipant[],
    senderId?: number
  ): { content: string; notifiedUserIds: number[] } {
    const mentionedIds = new Set<number>();
    let content = draft;

    // Sort by name length descending for greedy matching
    const sorted = [...participants].sort((a, b) => b.name.length - a.name.length);

    for (const p of sorted) {
      // Match @name (display name) — case-insensitive
      const namePattern = new RegExp(`@${this.escapeRegex(p.name)}(?![a-zA-Z])`, 'gi');
      const nameReplaced = content.replace(namePattern, `<@U${p.id}>`);
      if (nameReplaced !== content) {
        content = nameReplaced;
        mentionedIds.add(p.id);
      }

      // Match @userId (login ID)
      const idPattern = new RegExp(`@${this.escapeRegex(p.userId)}(?![a-zA-Z0-9_.-])`, 'g');
      const idReplaced = content.replace(idPattern, `<@U${p.id}>`);
      if (idReplaced !== content) {
        content = idReplaced;
        mentionedIds.add(p.id);
      }
    }

    // Always notify the sender if they exist
    if (senderId) {
      mentionedIds.add(senderId);
    }

    return { content, notifiedUserIds: Array.from(mentionedIds) };
  }

  private escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  async postSlackReply(filePath: string): Promise<void> {
    const parsed = this.fileService.parseSession(filePath);
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

    this.fileService.updateFrontmatter(parsed.meta.id, { sessionStatus: 'posted' });
  }
}
