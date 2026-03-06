// ---- TODO ----

export type TodoStatus = 'open' | 'in_progress' | 'waiting' | 'done';

export interface BacklogParticipant {
  id: number;
  userId: string;
  name: string;
}

export interface TodoContext {
  source: 'backlog-notification' | 'slack-mention' | 'slack-search' | 'google-doc' | 'manual';
  // Backlog
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
  // Slack
  slackChannel?: string;
  slackThreadTs?: string;
  slackMessageTs?: string;
  slackUserName?: string;
  slackText?: string;
  // Google Doc
  googleEventSummary?: string;
  googleEventDate?: string;
  googleDocId?: string;
  googleDocUrl?: string;
  googleMeetUrl?: string;
  googleAttendees?: string[];
}

export interface WorkspaceTodoItem {
  id: string;
  text: string;
  status: TodoStatus;
  createdAt: string;
  completedAt?: string;
  order: number;
  notes?: string;
  context?: TodoContext;
  replied?: boolean;
  repliedAt?: string;
  // Legacy (migration: completed → status)
  completed?: boolean;
}

// ---- Slack ----

export interface SlackChannel {
  id: string;
  name: string;
  is_im: boolean;
  is_mpim: boolean;
  unread_count: number;
  latest?: SlackMessage;
}

export interface SlackReaction {
  name: string;
  count: number;
  users: string[];
}

export interface SlackMessage {
  ts: string;
  user: string;
  text: string;
  thread_ts?: string;
  channel: string;
  channelName?: string;
  userName?: string;
  is_dm?: boolean;
  reactions?: SlackReaction[];
}

export interface SlackMention {
  channel: SlackChannel;
  message: SlackMessage;
}

// ---- Backlog Notification Reasons ----

export const NOTIFICATION_REASONS: Record<number, string> = {
  1: 'assigned',
  2: 'commented',
  3: 'updated',
  5: 'attached file',
  6: 'added to project',
  9: 'pull request',
  10: 'PR commented',
  11: 'PR updated',
};

// ---- Slack Service State ----

export interface UninitializedSlackService {
  readonly state: 'uninitialized';
  readonly error?: Error;
}

export interface InitializedSlackService {
  readonly state: 'initialized';
  readonly token: string;
}

export interface InitializingSlackService {
  readonly state: 'initializing';
  readonly initializationPromise: Promise<InitializedSlackService>;
}

export type SlackServiceState =
  | UninitializedSlackService
  | InitializingSlackService
  | InitializedSlackService;
