// ---- OAuth2 ----

export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

// ---- Calendar ----

export interface GoogleCalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
  htmlLink: string;
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: { entryPointType: string; uri: string }[];
  };
  attachments?: GoogleEventAttachment[];
  attendees?: GoogleEventAttendee[];
}

export interface GoogleEventAttachment {
  fileId: string;
  fileUrl: string;
  title: string;
  mimeType: string;
  iconLink?: string;
}

export interface GoogleEventAttendee {
  email: string;
  displayName?: string;
  self?: boolean;
  responseStatus: string;
}

// ---- Drive ----

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  modifiedTime: string;
  createdTime: string;
}

// ---- Service state ----

export interface UninitializedGoogleService {
  readonly state: 'uninitialized';
  readonly error?: Error;
}

export interface InitializingGoogleService {
  readonly state: 'initializing';
  readonly initializationPromise: Promise<InitializedGoogleService>;
}

export interface InitializedGoogleService {
  readonly state: 'initialized';
  readonly accessToken: string;
  readonly expiryDate: number;
}

export type GoogleServiceState =
  | UninitializedGoogleService
  | InitializingGoogleService
  | InitializedGoogleService;
