import { WebClient } from '@slack/web-api';
import { SlackConfig } from '../config/slackConfig';
import {
  SlackServiceState,
  InitializedSlackService,
  SlackChannel,
  SlackMessage,
} from '../types/workspace';
import { convertSlackEmoji } from '../utils/slackEmoji';

export type SlackTokenType = 'user' | 'bot' | 'unknown';

export class SlackApiService {
  private serviceState: SlackServiceState = { state: 'uninitialized' };
  private client: WebClient | null = null;
  private userCache = new Map<string, string>();
  private tokenType: SlackTokenType = 'unknown';
  private selfUserId: string | null = null;

  constructor(private configService: SlackConfig) {}

  getTokenType(): SlackTokenType {
    return this.tokenType;
  }

  private async initializeService(): Promise<InitializedSlackService> {
    const token = await this.configService.getToken();
    if (!token) {
      throw new Error('Slack token is not configured');
    }
    this.client = new WebClient(token);
    this.tokenType = token.startsWith('xoxp-')
      ? 'user'
      : token.startsWith('xoxb-')
      ? 'bot'
      : 'unknown';
    return { state: 'initialized', token };
  }

  private async ensureInitialized(): Promise<InitializedSlackService> {
    if (this.serviceState.state === 'initialized') {
      return this.serviceState;
    }
    if (this.serviceState.state === 'initializing') {
      return await this.serviceState.initializationPromise;
    }
    const initializationPromise = this.initializeService();
    this.serviceState = { state: 'initializing', initializationPromise };
    try {
      const result = await initializationPromise;
      this.serviceState = result;
      return result;
    } catch (error) {
      this.serviceState = { state: 'uninitialized', error: error as Error };
      throw error;
    }
  }

  async isConfigured(): Promise<boolean> {
    const token = await this.configService.getToken();
    return !!token;
  }

  async reinitialize(): Promise<void> {
    this.serviceState = { state: 'uninitialized' };
    this.client = null;
    this.tokenType = 'unknown';
    this.selfUserId = null;
    this.userCache.clear();
    await this.ensureInitialized();
  }

  /**
   * Test connection and return auth info (user, team, token type).
   */
  async testConnection(): Promise<{
    ok: boolean;
    user?: string;
    team?: string;
    tokenType?: SlackTokenType;
    error?: string;
  }> {
    try {
      await this.ensureInitialized();
      if (!this.client) {
        return { ok: false, error: 'Client not initialized' };
      }
      const resp = await this.client.auth.test();
      return {
        ok: !!resp.ok,
        user: (resp.user as string) || '',
        team: (resp.team as string) || '',
        tokenType: this.tokenType,
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getChannels(): Promise<SlackChannel[]> {
    await this.ensureInitialized();
    if (!this.client) {
      return [];
    }

    const result: SlackChannel[] = [];

    try {
      const resp = await this.client.conversations.list({
        exclude_archived: true,
        types: 'public_channel,private_channel,im,mpim',
        limit: 200,
      });

      for (const ch of resp.channels || []) {
        if (!ch.id) {
          continue;
        }
        const chAny = ch as Record<string, unknown>;
        const unread =
          (chAny.unread_count_display as number) || (chAny.unread_count as number) || 0;
        result.push({
          id: ch.id,
          name: ch.name || ch.id,
          is_im: !!ch.is_im,
          is_mpim: !!ch.is_mpim,
          unread_count: unread,
        });
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('not_allowed_token_type') || errMsg.includes('missing_scope')) {
        console.log(`[Slack] conversations.list not available: ${errMsg}`);
        throw new Error(
          `conversations.list に必要なスコープがありません。` +
            `\nToken type: ${this.tokenType}` +
            `\n必要なスコープ: channels:read, groups:read, im:read, mpim:read` +
            `\n(${errMsg})`
        );
      }
      throw error;
    }

    const unreadCount = result.filter((ch) => ch.unread_count > 0).length;
    console.log(
      `[Slack] conversations.list: ${result.length} channels total, ${unreadCount} with unread`
    );
    return result;
  }

  /**
   * Resolve and cache the authenticated user's ID via auth.test.
   */
  private async getSelfUserId(): Promise<string | null> {
    if (this.selfUserId) {
      return this.selfUserId;
    }
    if (!this.client) {
      return null;
    }
    try {
      const resp = await this.client.auth.test();
      this.selfUserId = (resp.user_id as string) || null;
      return this.selfUserId;
    } catch {
      return null;
    }
  }

  /**
   * Get recent notifications (@mentions in channels, optionally DMs).
   * Requires user token (xoxp-) with search:read scope.
   * Returns empty array for bot tokens (search.messages is not supported).
   */
  async getMentions(options?: { count?: number; includeDMs?: boolean }): Promise<SlackMessage[]> {
    const { count = 20, includeDMs = false } = options || {};
    await this.ensureInitialized();
    if (!this.client) {
      return [];
    }

    // search.messages only works with user tokens
    if (this.tokenType === 'bot') {
      console.log('[Slack] Skipping search.messages (bot token does not support it)');
      return [];
    }

    try {
      const selfId = await this.getSelfUserId();

      // Fetch channel mentions
      const mentionQuery = selfId ? `<@${selfId}>` : 'to:me';
      const mentionResp = await this.client.search.messages({
        query: mentionQuery,
        sort: 'timestamp',
        sort_dir: 'desc',
        count,
      });
      const mentionMatches = mentionResp.messages?.matches || [];
      console.log(`[Slack] search.messages "${mentionQuery}": ${mentionMatches.length} matches`);

      // Fetch DMs separately if enabled
      let dmMatches: typeof mentionMatches = [];
      if (includeDMs) {
        const dmCount = Math.max(10, Math.floor(count / 2));
        const dmResp = await this.client.search.messages({
          query: 'is:dm',
          sort: 'timestamp',
          sort_dir: 'desc',
          count: dmCount,
        });
        dmMatches = dmResp.messages?.matches || [];
        console.log(`[Slack] search.messages "is:dm": ${dmMatches.length} matches`);

        // Also fetch group DMs
        const mpimResp = await this.client.search.messages({
          query: 'is:mpim',
          sort: 'timestamp',
          sort_dir: 'desc',
          count: dmCount,
        });
        const mpimMatches = mpimResp.messages?.matches || [];
        console.log(`[Slack] search.messages "is:mpim": ${mpimMatches.length} matches`);
        dmMatches = [...dmMatches, ...mpimMatches];
      }

      // Merge and deduplicate
      const allMatches = [...mentionMatches, ...dmMatches];
      const seen = new Set<string>();
      const messages: SlackMessage[] = [];
      for (const match of allMatches) {
        const chObj = match.channel as Record<string, unknown> | undefined;
        const channelId = (chObj?.id as string) || '';
        const key = `${channelId}:${match.ts}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        // Skip own messages
        if (selfId && match.user === selfId) {
          continue;
        }

        const isDm = !!chObj?.is_im || !!chObj?.is_mpim;
        const userName = await this.resolveUserName(match.user || '');
        messages.push({
          ts: match.ts || '',
          user: match.user || '',
          text: convertSlackEmoji(match.text || ''),
          thread_ts: (match as Record<string, unknown>).thread_ts as string | undefined,
          channel: channelId,
          userName,
          is_dm: isDm,
        });
      }
      // Sort by timestamp descending (newest first)
      messages.sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts));
      return messages;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('not_allowed_token_type') || errMsg.includes('missing_scope')) {
        console.log(`[Slack] search.messages not available: ${errMsg}`);
        throw new Error(
          'search:read スコープが必要です (トークンの OAuth スコープを確認してください)'
        );
      }
      throw error;
    }
  }

  /**
   * Search Slack messages by keyword. Requires user token (xoxp-) with search:read scope.
   * Returns empty array for bot tokens.
   */
  async searchMessages(query: string, count: number = 20): Promise<SlackMessage[]> {
    await this.ensureInitialized();
    if (!this.client) {
      return [];
    }

    if (this.tokenType === 'bot') {
      return [];
    }

    try {
      const resp = await this.client.search.messages({
        query,
        sort: 'timestamp',
        sort_dir: 'desc',
        count,
      });

      const matches = resp.messages?.matches || [];
      console.log(`[Slack] search.messages "${query}": ${matches.length} matches`);

      const messages: SlackMessage[] = [];
      for (const match of matches) {
        const userName = await this.resolveUserName(match.user || '');
        messages.push({
          ts: match.ts || '',
          user: match.user || '',
          text: convertSlackEmoji(match.text || ''),
          thread_ts: (match as Record<string, unknown>).thread_ts as string | undefined,
          channel: ((match.channel as Record<string, unknown>)?.id as string) || '',
          userName,
        });
      }
      return messages;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('not_allowed_token_type') || errMsg.includes('missing_scope')) {
        console.log(`[Slack] search.messages not available for keyword: ${errMsg}`);
        throw new Error(
          'search:read スコープが必要です (トークンの OAuth スコープを確認してください)'
        );
      }
      throw error;
    }
  }

  async getThreadMessages(channel: string, ts: string): Promise<SlackMessage[]> {
    await this.ensureInitialized();
    if (!this.client) {
      return [];
    }

    try {
      const resp = await this.client.conversations.replies({
        channel,
        ts,
        limit: 50,
      });

      const messages: SlackMessage[] = [];
      for (const msg of resp.messages || []) {
        const userName = await this.resolveUserName(msg.user || '');
        messages.push({
          ts: msg.ts || '',
          user: msg.user || '',
          text: convertSlackEmoji(msg.text || ''),
          thread_ts: msg.thread_ts,
          channel,
          userName,
        });
      }
      return messages;
    } catch (error) {
      const slackError = error as Record<string, unknown>;
      const errMsg = error instanceof Error ? error.message : String(error);
      const neededScope = (slackError.data as Record<string, unknown>)?.needed as string;
      console.error(
        `[Slack] conversations.replies failed: ${errMsg}`,
        `channel=${channel}`,
        `needed=${neededScope || 'unknown'}`
      );
      if (errMsg.includes('not_allowed_token_type') || errMsg.includes('missing_scope')) {
        throw new Error(
          `スレッド取得に失敗しました: スコープ不足` +
            (neededScope ? ` (必要: ${neededScope})` : '') +
            ` — ${errMsg}`
        );
      }
      if (errMsg.includes('channel_not_found') || errMsg.includes('not_in_channel')) {
        throw new Error(`チャンネルにアクセスできません (${errMsg})`);
      }
      throw error;
    }
  }

  /**
   * Get surrounding channel messages around a given timestamp.
   * Returns messages before and after the target, excluding the target itself.
   * Silently returns empty arrays on scope errors.
   */
  async getChannelContext(
    channel: string,
    aroundTs: string,
    count: number = 3
  ): Promise<{ before: SlackMessage[]; after: SlackMessage[] }> {
    await this.ensureInitialized();
    if (!this.client) {
      return { before: [], after: [] };
    }

    try {
      const [beforeResp, afterResp] = await Promise.all([
        this.client.conversations.history({
          channel,
          latest: aroundTs,
          inclusive: false,
          limit: count,
        }),
        this.client.conversations.history({
          channel,
          oldest: aroundTs,
          inclusive: false,
          limit: count,
        }),
      ]);

      const toSlackMessages = async (
        msgs: Array<Record<string, unknown>>
      ): Promise<SlackMessage[]> => {
        const result: SlackMessage[] = [];
        for (const msg of msgs) {
          const userName = await this.resolveUserName((msg.user as string) || '');
          result.push({
            ts: (msg.ts as string) || '',
            user: (msg.user as string) || '',
            text: convertSlackEmoji((msg.text as string) || ''),
            thread_ts: msg.thread_ts as string | undefined,
            channel,
            userName,
          });
        }
        return result;
      };

      const beforeMsgs = await toSlackMessages(
        ((beforeResp.messages as Array<Record<string, unknown>>) || []).reverse()
      );
      const afterMsgs = await toSlackMessages(
        (afterResp.messages as Array<Record<string, unknown>>) || []
      );

      return { before: beforeMsgs, after: afterMsgs };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (
        errMsg.includes('not_allowed_token_type') ||
        errMsg.includes('missing_scope') ||
        errMsg.includes('channel_not_found') ||
        errMsg.includes('not_in_channel')
      ) {
        console.log(`[Slack] conversations.history not available: ${errMsg}`);
        return { before: [], after: [] };
      }
      console.error(`[Slack] getChannelContext failed: ${errMsg}`);
      return { before: [], after: [] };
    }
  }

  async getPermalink(channel: string, messageTs: string): Promise<string | null> {
    await this.ensureInitialized();
    if (!this.client) {
      return null;
    }
    try {
      const resp = await this.client.chat.getPermalink({
        channel,
        message_ts: messageTs,
      });
      return (resp.permalink as string) || null;
    } catch {
      return null;
    }
  }

  async postMessage(channel: string, text: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.client) {
      return;
    }

    await this.client.chat.postMessage({ channel, text });
  }

  async postReply(channel: string, threadTs: string, text: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.client) {
      return;
    }

    await this.client.chat.postMessage({
      channel,
      text,
      thread_ts: threadTs,
    });
  }

  async resolveUserName(userId: string): Promise<string> {
    if (!userId) {
      return 'Unknown';
    }
    const cached = this.userCache.get(userId);
    if (cached) {
      return cached;
    }

    try {
      await this.ensureInitialized();
      if (!this.client) {
        return userId;
      }
      const resp = await this.client.users.info({ user: userId });
      const name = resp.user?.real_name || resp.user?.name || userId;
      this.userCache.set(userId, name);
      return name;
    } catch {
      return userId;
    }
  }
}
