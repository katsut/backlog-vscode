import { WebClient } from '@slack/web-api';
import { SlackConfig } from '../config/slackConfig';
import {
  SlackServiceState,
  InitializedSlackService,
  SlackChannel,
  SlackMessage,
  SlackReaction,
} from '../types/workspace';
import { convertSlackEmoji } from '../utils/slackEmoji';

export type SlackTokenType = 'user' | 'bot' | 'unknown';

export class SlackApiService {
  private serviceState: SlackServiceState = { state: 'uninitialized' };
  private client: WebClient | null = null;
  private userCache = new Map<string, string>();
  private tokenType: SlackTokenType = 'unknown';
  private selfUserId: string | null = null;
  /** Cached set of channel IDs the user is a member of */
  private memberChannelIds: Set<string> | null = null;
  private memberChannelsCacheTime = 0;
  /** Cached user group IDs the user belongs to */
  private myGroupIds: string[] | null = null;
  private myGroupsCacheTime = 0;

  private log: (msg: string) => void;

  constructor(private configService: SlackConfig, log?: (msg: string) => void) {
    this.log = log || (() => {});
  }

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
    this.memberChannelIds = null;
    this.myGroupIds = null;
    await this.ensureInitialized();
  }

  /** Pre-warm caches (selfId, memberChannels, userGroups) so first poll is fast. */
  async warmUpCaches(): Promise<void> {
    await this.ensureInitialized();
    if (!this.client || this.tokenType === 'bot') {
      return;
    }
    await Promise.all([this.getSelfUserId(), this.getMemberChannelIds(), this.getMyUserGroupIds()]);
  }

  /** Get the set of channel IDs the user is a member of (cached 5 min) */
  private async getMemberChannelIds(): Promise<Set<string>> {
    const CACHE_TTL = 5 * 60 * 1000;
    if (this.memberChannelIds && Date.now() - this.memberChannelsCacheTime < CACHE_TTL) {
      return this.memberChannelIds;
    }
    await this.ensureInitialized();
    if (!this.client) {
      return new Set();
    }
    const ids = new Set<string>();
    let cursor: string | undefined;
    do {
      const resp = await this.client.users.conversations({
        types: 'public_channel,private_channel,mpim,im',
        limit: 200,
        cursor,
      });
      for (const ch of resp.channels || []) {
        if (ch.id) {
          ids.add(ch.id);
        }
      }
      cursor = resp.response_metadata?.next_cursor || undefined;
    } while (cursor);
    this.memberChannelIds = ids;
    this.memberChannelsCacheTime = Date.now();
    console.log(`[Slack] getMemberChannelIds: ${ids.size} channels`);
    return ids;
  }

  /**
   * Get user group IDs the current user belongs to.
   * Uses disk-persisted cache for instant startup, refreshes from API in background.
   */
  private async getMyUserGroupIds(): Promise<string[]> {
    const CACHE_TTL = 30 * 60 * 1000;
    if (this.myGroupIds && Date.now() - this.myGroupsCacheTime < CACHE_TTL) {
      return this.myGroupIds;
    }

    // Load from disk cache immediately (no API call)
    const persisted = this.configService.getMyGroupIds();
    if (persisted.length > 0 && !this.myGroupIds) {
      this.myGroupIds = persisted;
      this.myGroupsCacheTime = Date.now();
      this.log(`[Slack] usergroups: loaded ${persisted.length} from disk`);
      // Refresh from API in background (non-blocking)
      this.refreshUserGroupIds().catch(() => {});
      return persisted;
    }

    // No disk cache — must fetch from API (first-ever run)
    return this.refreshUserGroupIds();
  }

  /** Fetch user group IDs from Slack API and persist to disk. */
  private async refreshUserGroupIds(): Promise<string[]> {
    await this.ensureInitialized();
    if (!this.client) {
      return this.myGroupIds || [];
    }
    try {
      const selfId = await this.getSelfUserId();
      if (!selfId) {
        this.log('[Slack] getMyUserGroupIds: no selfId');
        return this.myGroupIds || [];
      }
      const resp = await this.client.usergroups.list({ include_users: true });
      const allGroups = resp.usergroups || [];
      // Filter out disabled/deleted groups
      const groups = allGroups.filter((g) => !g.date_delete || g.date_delete === 0);
      const myGroups = groups.filter((g) => g.users?.includes(selfId));
      const myGroupIds = myGroups.map((g) => g.id!).filter(Boolean);
      this.myGroupIds = myGroupIds;
      this.myGroupsCacheTime = Date.now();
      this.configService.setMyGroupIds(myGroupIds);
      const handles = myGroups.map((g) => `@${g.handle}`).join(', ');
      this.log(
        `[Slack] usergroups: ${myGroupIds.length}/${groups.length} active mine [${handles}]`
      );
      return myGroupIds;
    } catch (error) {
      this.log(`[Slack] usergroups.list failed: ${error}`);
      return this.myGroupIds || [];
    }
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
  async getMentions(options?: {
    count?: number;
    includeDMs?: boolean;
    onProgress?: (messages: SlackMessage[]) => void;
  }): Promise<SlackMessage[]> {
    const { count = 20, includeDMs = false, onProgress } = options || {};
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
      const [selfId, memberChannels, myGroupIds] = await Promise.all([
        this.getSelfUserId(),
        this.getMemberChannelIds(),
        this.getMyUserGroupIds(),
      ]);

      // Date filter: only search last 2 weeks
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const afterDate = twoWeeksAgo.toISOString().slice(0, 10); // YYYY-MM-DD
      const after = ` after:${afterDate}`;

      // Priority: direct mentions > DMs > @channel/@here > subteam groups (last)
      const directQuery = selfId ? `<@${selfId}>` : 'to:me';
      const queries: { q: string; c: number }[] = [];
      queries.push({ q: directQuery + after, c: count });
      if (includeDMs) {
        const dmCount = Math.max(10, Math.floor(count / 2));
        queries.push({ q: 'is:dm' + after, c: dmCount }, { q: 'is:mpim' + after, c: dmCount });
      }
      queries.push(
        { q: '<!channel>' + after, c: Math.max(10, Math.floor(count / 2)) },
        { q: '<!here>' + after, c: Math.max(10, Math.floor(count / 2)) }
      );
      for (const gid of myGroupIds) {
        queries.push({ q: `<!subteam^${gid}>${after}`, c: Math.max(10, Math.floor(count / 2)) });
      }

      // Run searches with concurrency limit, emitting partial results after each batch
      const CONCURRENCY = 3;
      const seen = new Set<string>();
      const messages: SlackMessage[] = [];

      // Helper: merge raw matches into messages, deduplicate, filter
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mergeMatches = (matches: any[], queryLabel: string) => {
        let skipSelf = 0;
        let skipNonMember = 0;
        let added = 0;
        for (const match of matches) {
          const chObj = match.channel as Record<string, unknown> | undefined;
          const channelId = (chObj?.id as string) || '';
          const key = `${channelId}:${match.ts}`;
          if (seen.has(key)) {
            continue;
          }
          seen.add(key);
          if (selfId && match.user === selfId) {
            skipSelf++;
            continue;
          }
          const isDm = !!chObj?.is_im || !!chObj?.is_mpim;
          if (!isDm && channelId && memberChannels.size > 0 && !memberChannels.has(channelId)) {
            skipNonMember++;
            continue;
          }
          added++;
          const channelName = (chObj?.name as string) || undefined;
          messages.push({
            ts: match.ts || '',
            user: match.user || '',
            text: convertSlackEmoji(match.text || ''),
            thread_ts: (match as Record<string, unknown>).thread_ts as string | undefined,
            channel: channelId,
            channelName: isDm ? undefined : channelName,
            userName: match.user || '',
            is_dm: isDm,
          });
        }
        if (skipSelf > 0 || skipNonMember > 0) {
          this.log(
            `[Slack] merge "${queryLabel}": +${added}, skipSelf=${skipSelf}, skipNonMember=${skipNonMember}`
          );
        }
      };

      for (let i = 0; i < queries.length; i += CONCURRENCY) {
        const batch = queries.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.all(
          batch.map(async ({ q, c }) => {
            const resp = await this.client!.search.messages({
              query: q,
              sort: 'timestamp',
              sort_dir: 'desc',
              count: c,
            });
            const matches = resp.messages?.matches || [];
            this.log(`[Slack] search.messages "${q}": ${matches.length} matches`);
            return matches;
          })
        );

        // Merge batch results
        for (let j = 0; j < batchResults.length; j++) {
          const label = batch[j].q;
          mergeMatches(batchResults[j], label);
        }

        // Resolve new user names and emit progress
        const unresolvedIds = messages
          .filter((m) => m.userName === m.user && m.user)
          .map((m) => m.user);
        const uniqueNew = [...new Set(unresolvedIds)].filter((id) => !this.userCache.has(id));
        if (uniqueNew.length > 0) {
          await Promise.all(uniqueNew.map((uid) => this.resolveUserName(uid)));
        }
        for (const m of messages) {
          m.userName = this.userCache.get(m.user) || m.user;
        }

        // Process all Slack formatting in message text
        await Promise.all(
          messages.map(async (m) => {
            m.text = await this.preprocessSlackText(m.text);
          })
        );

        // Sort and emit partial results
        messages.sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts));
        onProgress?.(messages);
      }

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

      const messages: SlackMessage[] = matches.map((match) => {
        const chObj = match.channel as Record<string, unknown> | undefined;
        return {
          ts: match.ts || '',
          user: match.user || '',
          text: convertSlackEmoji(match.text || ''),
          thread_ts: (match as Record<string, unknown>).thread_ts as string | undefined,
          channel: (chObj?.id as string) || '',
          channelName: (chObj?.name as string) || undefined,
          userName: match.user || '',
        };
      });

      // Resolve user names in parallel
      const uniqueUserIds = [...new Set(messages.map((m) => m.user).filter(Boolean))];
      await Promise.all(uniqueUserIds.map((uid) => this.resolveUserName(uid)));
      for (const m of messages) {
        m.userName = this.userCache.get(m.user) || m.user;
      }
      // Process all Slack formatting in message text
      await Promise.all(
        messages.map(async (m) => {
          m.text = await this.preprocessSlackText(m.text);
        })
      );
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
        const text = await this.preprocessSlackText(convertSlackEmoji(msg.text || ''));
        const msgAny = msg as Record<string, unknown>;
        const reactions = this.extractReactions(msgAny.reactions as any[] | undefined);
        messages.push({
          ts: msg.ts || '',
          user: msg.user || '',
          text,
          thread_ts: msg.thread_ts,
          channel,
          userName,
          reactions,
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
          const text = await this.preprocessSlackText(
            convertSlackEmoji((msg.text as string) || '')
          );
          result.push({
            ts: (msg.ts as string) || '',
            user: (msg.user as string) || '',
            text,
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

  async addReaction(channel: string, timestamp: string, name: string): Promise<void> {
    await this.ensureInitialized();
    if (!this.client) {
      return;
    }
    await this.client.reactions.add({ channel, timestamp, name });
  }

  private extractReactions(raw: any[] | undefined): SlackReaction[] | undefined {
    if (!raw || !Array.isArray(raw) || raw.length === 0) {
      return undefined;
    }
    return raw.map((r: any) => ({
      name: r.name || '',
      count: r.count || 0,
      users: r.users || [],
    }));
  }

  /**
   * Process all Slack special formatting: mentions, links, channels, markdown, etc.
   * Converts Slack's mrkdwn format to standard Markdown for rendering.
   * This should be called on all message text before displaying.
   */
  async preprocessSlackText(text: string): Promise<string> {
    let processed = text;

    // 1. User mentions with display name: <@U123|Display Name> → @Display Name
    processed = processed.replace(/<@([A-Z0-9]+)\|([^>]+)>/g, (_, _userId, displayName) => {
      return `@${displayName}`;
    });

    // 2. User mentions without display name: <@U123> → @User Name (resolve from API)
    const simpleMentionPattern = /<@(U[A-Z0-9]+)>/g;
    const userIds = new Set<string>();
    let match;
    while ((match = simpleMentionPattern.exec(processed)) !== null) {
      userIds.add(match[1]);
    }
    if (userIds.size > 0) {
      await Promise.all([...userIds].map((id) => this.resolveUserName(id)));
      processed = processed.replace(/<@(U[A-Z0-9]+)>/g, (_, id) => {
        const name = this.userCache.get(id);
        return name ? `@${name}` : `@${id}`;
      });
    }

    // 3. Subteam/usergroup mentions: <!subteam^S123|@group> → @group
    processed = processed.replace(/<!subteam\^([A-Z0-9]+)\|@([^>]+)>/g, (_, _groupId, handle) => {
      return `@${handle}`;
    });

    // 4. Subteam/usergroup without display name: <!subteam^S123> → @group-handle (would need API lookup)
    // For now, just show the ID without the special syntax
    processed = processed.replace(/<!subteam\^([A-Z0-9]+)>/g, (_, groupId) => {
      return `@usergroup-${groupId}`;
    });

    // 5. Channel mentions with name: <#C123|channel-name> → #channel-name
    processed = processed.replace(/<#([A-Z0-9]+)\|([^>]+)>/g, (_, _channelId, channelName) => {
      return `#${channelName}`;
    });

    // 6. Channel mentions without name: <#C123> → #C123 (would need API lookup)
    processed = processed.replace(/<#([A-Z0-9]+)>/g, (_, channelId) => {
      return `#${channelId}`;
    });

    // 7. Special mentions: <!channel>, <!here>, <!everyone>
    processed = processed.replace(/<!channel>/g, '@channel');
    processed = processed.replace(/<!here>/g, '@here');
    processed = processed.replace(/<!everyone>/g, '@everyone');

    // 8. Links with text: <URL|Link Text> → [Link Text](URL)
    processed = processed.replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, (_, url, linkText) => {
      return `[${linkText}](${url})`;
    });

    // 9. Bare URLs in angle brackets: <URL> → URL
    processed = processed.replace(/<(https?:\/\/[^>]+)>/g, (_, url) => {
      return url;
    });

    // 10. Slack mrkdwn to Markdown conversion
    // Note: Must be done carefully to avoid conflicts with already-processed content

    // Code blocks: ```text``` (same as Markdown, no conversion needed)
    // Already compatible

    // Inline code: `code` (same as Markdown, no conversion needed)
    // Already compatible

    // Bold: *text* → **text**
    // Match at word boundaries (start of line, whitespace, or non-word char before/after)
    // But not if already doubled (**) or tripled (***)
    processed = processed.replace(/(?<=^|[^*\w])\*([^*\n]+?)\*(?=[^*\w]|$)/g, '**$1**');

    // Italic: _text_ → *text*
    // Match at word boundaries, not within words (avoid matching snake_case)
    processed = processed.replace(/(?<=^|[\s\p{P}])_([^_\n]+?)_(?=[\s\p{P}]|$)/gu, '*$1*');

    // Strike: ~text~ → ~~text~~
    // Match at word boundaries
    processed = processed.replace(/(?<=^|[^~\w])~([^~\n]+?)~(?=[^~\w]|$)/g, '~~$1~~');

    // Block quotes: Slack uses > at line start (same as Markdown)
    // Already compatible

    return processed;
  }

  /**
   * @deprecated Use preprocessSlackText instead for complete Slack formatting support
   */
  async resolveUserMentions(text: string): Promise<string> {
    return this.preprocessSlackText(text);
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
