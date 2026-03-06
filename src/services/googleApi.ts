import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { GoogleConfig } from '../config/googleConfig';
import {
  GoogleServiceState,
  InitializedGoogleService,
  GoogleCalendarEvent,
  GoogleDriveFile,
} from '../types/google';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REDIRECT_PORT = 52849;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}`;
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ');

export class GoogleApiService {
  private serviceState: GoogleServiceState = { state: 'uninitialized' };

  constructor(private configService: GoogleConfig) {}

  // ---- OAuth2 ----

  async authenticate(): Promise<void> {
    const clientId = this.configService.getClientId();
    const clientSecret = await this.configService.getClientSecret();

    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth の Client ID / Client Secret が設定されていません。');
    }

    const code = await this.openBrowserAndWaitForCode(clientId);
    const tokens = await this.exchangeCodeForTokens(code, clientId, clientSecret);

    if (tokens.refresh_token) {
      await this.configService.setRefreshToken(tokens.refresh_token);
    }

    this.serviceState = {
      state: 'initialized',
      accessToken: tokens.access_token,
      expiryDate: Date.now() + tokens.expires_in * 1000,
    };
  }

  private openBrowserAndWaitForCode(clientId: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url || '', `http://localhost:${REDIRECT_PORT}`);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (code) {
          res.end(
            '<html><body><h2>認証完了</h2><p>このタブを閉じて VSCode に戻ってください。</p></body></html>'
          );
        } else {
          res.end(
            `<html><body><h2>認証エラー</h2><p>${error || 'Unknown error'}</p></body></html>`
          );
        }

        server.close();

        if (code) {
          resolve(code);
        } else {
          reject(new Error(`Google OAuth error: ${error}`));
        }
      });

      server.listen(REDIRECT_PORT, () => {
        const params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: REDIRECT_URI,
          response_type: 'code',
          scope: SCOPES,
          access_type: 'offline',
          prompt: 'consent',
        });

        vscode.env.openExternal(vscode.Uri.parse(`${GOOGLE_AUTH_URL}?${params}`));
      });

      server.on('error', (err) => {
        reject(new Error(`ローカルサーバーの起動に失敗: ${err.message}`));
      });

      // Timeout after 2 minutes
      setTimeout(() => {
        server.close();
        reject(new Error('認証がタイムアウトしました（2分）'));
      }, 120000);
    });
  }

  private async exchangeCodeForTokens(
    code: string,
    clientId: string,
    clientSecret: string
  ): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    }).toString();

    return await this.httpsPost(GOOGLE_TOKEN_URL, body);
  }

  private async refreshAccessToken(): Promise<{ access_token: string; expires_in: number }> {
    const clientId = this.configService.getClientId();
    const clientSecret = await this.configService.getClientSecret();
    const refreshToken = await this.configService.getRefreshToken();

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('not configured');
    }

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString();

    return await this.httpsPost(GOOGLE_TOKEN_URL, body);
  }

  private async ensureInitialized(): Promise<InitializedGoogleService> {
    if (this.serviceState.state === 'initialized') {
      if (this.serviceState.expiryDate - Date.now() < 60000) {
        const tokens = await this.refreshAccessToken();
        this.serviceState = {
          state: 'initialized',
          accessToken: tokens.access_token,
          expiryDate: Date.now() + tokens.expires_in * 1000,
        };
      }
      return this.serviceState as InitializedGoogleService;
    }

    if (this.serviceState.state === 'initializing') {
      return await this.serviceState.initializationPromise;
    }

    // If no refresh token, start OAuth flow automatically
    const hasRefreshToken = await this.configService.getRefreshToken();
    if (!hasRefreshToken) {
      await this.authenticate();
      // authenticate() sets serviceState to 'initialized' on success
      return this.serviceState as unknown as InitializedGoogleService;
    }

    const initializationPromise = this.refreshAccessToken().then((tokens) => {
      const initialized: InitializedGoogleService = {
        state: 'initialized',
        accessToken: tokens.access_token,
        expiryDate: Date.now() + tokens.expires_in * 1000,
      };
      this.serviceState = initialized;
      return initialized;
    });

    this.serviceState = { state: 'initializing', initializationPromise };

    try {
      return await initializationPromise;
    } catch (error) {
      this.serviceState = { state: 'uninitialized', error: error as Error };
      throw error;
    }
  }

  async isConfigured(): Promise<boolean> {
    const refreshToken = await this.configService.getRefreshToken();
    return !!refreshToken;
  }

  reinitialize(): void {
    this.serviceState = { state: 'uninitialized' };
  }

  async signOut(): Promise<void> {
    await this.configService.clearTokens();
    this.serviceState = { state: 'uninitialized' };
  }

  // ---- Calendar API ----

  async getEvents(timeMin: string, timeMax: string): Promise<GoogleCalendarEvent[]> {
    const { accessToken } = await this.ensureInitialized();
    const calendarId = this.configService.getCalendarId();

    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events?${params}`;
    const data = await this.httpsGetAuth<{ items?: GoogleCalendarEvent[] }>(url, accessToken);
    return data.items || [];
  }

  // ---- Drive API ----

  async searchDriveFiles(query: string): Promise<GoogleDriveFile[]> {
    const { accessToken } = await this.ensureInitialized();

    const escaped = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = `(fullText contains '${escaped}' or name contains '${escaped}') and trashed = false`;

    const params = new URLSearchParams({
      q,
      fields: 'files(id,name,mimeType,webViewLink,modifiedTime,createdTime)',
      orderBy: 'modifiedTime desc',
      pageSize: '30',
    });

    const url = `https://www.googleapis.com/drive/v3/files?${params}`;
    const data = await this.httpsGetAuth<{ files?: GoogleDriveFile[] }>(url, accessToken);
    return data.files || [];
  }

  async downloadFile(fileId: string): Promise<Buffer> {
    const { accessToken } = await this.ensureInitialized();
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    return await this.httpsGetBuffer(url, accessToken);
  }

  async searchMeetingNotes(
    eventSummary: string,
    eventStartTime: string
  ): Promise<GoogleDriveFile[]> {
    const { accessToken } = await this.ensureInitialized();

    const escapedSummary = eventSummary.replace(/'/g, "\\'");
    const q = `name contains '${escapedSummary}' and mimeType = 'application/vnd.google-apps.document' and modifiedTime > '${eventStartTime}'`;

    const params = new URLSearchParams({
      q,
      fields: 'files(id,name,mimeType,webViewLink,modifiedTime,createdTime)',
      orderBy: 'modifiedTime desc',
      pageSize: '10',
    });

    const url = `https://www.googleapis.com/drive/v3/files?${params}`;
    const data = await this.httpsGetAuth<{ files?: GoogleDriveFile[] }>(url, accessToken);
    return data.files || [];
  }

  async getFileContent(fileId: string): Promise<string> {
    const { accessToken } = await this.ensureInitialized();
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      fileId
    )}/export?mimeType=text/html`;
    return await this.httpsGetRaw(url, accessToken);
  }

  async getFileMetadata(fileId: string): Promise<GoogleDriveFile> {
    const { accessToken } = await this.ensureInitialized();
    const params = new URLSearchParams({
      fields: 'id,name,mimeType,webViewLink,modifiedTime,createdTime',
    });
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params}`;
    return await this.httpsGetAuth<GoogleDriveFile>(url, accessToken);
  }

  // ---- Helpers: combine attachments + Drive search ----

  async getDocumentsForEvent(event: GoogleCalendarEvent): Promise<GoogleDriveFile[]> {
    const docs: GoogleDriveFile[] = [];
    const seenIds = new Set<string>();

    // 1. Event attachments
    if (event.attachments) {
      for (const att of event.attachments) {
        if (att.fileId && !seenIds.has(att.fileId)) {
          seenIds.add(att.fileId);
          try {
            const meta = await this.getFileMetadata(att.fileId);
            docs.push(meta);
          } catch {
            docs.push({
              id: att.fileId,
              name: att.title,
              mimeType: att.mimeType,
              webViewLink: att.fileUrl,
              modifiedTime: '',
              createdTime: '',
            });
          }
        }
      }
    }

    // 2. Search Drive for meeting notes matching the event title
    if (event.summary) {
      const startTime = event.start.dateTime || event.start.date || '';
      try {
        const notes = await this.searchMeetingNotes(event.summary, startTime);
        for (const note of notes) {
          if (!seenIds.has(note.id)) {
            seenIds.add(note.id);
            docs.push(note);
          }
        }
      } catch {
        // Search failure is non-fatal
      }
    }

    return docs;
  }

  // ---- HTTP Utilities ----

  private httpsPost<T>(url: string, body: string): Promise<T> {
    const parsed = new URL(url);
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    return new Promise<T>((resolve, reject) => {
      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8');
          try {
            const json = JSON.parse(text);
            if (json.error) {
              reject(new Error(`Google API error: ${json.error_description || json.error}`));
            } else {
              resolve(json as T);
            }
          } catch {
            reject(new Error(`Failed to parse Google API response: ${text.substring(0, 200)}`));
          }
        });
        res.on('error', reject);
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Google API request timeout'));
      });
      req.write(body);
      req.end();
    });
  }

  private httpsGetAuth<T>(url: string, accessToken: string): Promise<T> {
    const parsed = new URL(url);
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    };

    return new Promise<T>((resolve, reject) => {
      const req = https.request(options, (res) => {
        if (res.statusCode === 401) {
          reject(new Error('Google API: Unauthorized (token expired)'));
          res.resume();
          return;
        }
        if (res.statusCode && res.statusCode >= 400) {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf-8');
            reject(new Error(`Google API HTTP ${res.statusCode}: ${text.substring(0, 200)}`));
          });
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T);
          } catch (error) {
            reject(new Error(`Failed to parse Google API response: ${error}`));
          }
        });
        res.on('error', reject);
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Google API request timeout'));
      });
      req.end();
    });
  }

  private httpsGetBuffer(url: string, accessToken: string): Promise<Buffer> {
    const parsed = new URL(url);
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    };

    return new Promise<Buffer>((resolve, reject) => {
      const req = https.request(options, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Google API HTTP ${res.statusCode}`));
          res.resume();
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Google API request timeout'));
      });
      req.end();
    });
  }

  private httpsGetRaw(url: string, accessToken: string): Promise<string> {
    const parsed = new URL(url);
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    };

    return new Promise<string>((resolve, reject) => {
      const req = https.request(options, (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Google API HTTP ${res.statusCode}`));
          res.resume();
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      });

      req.on('error', reject);
      req.setTimeout(30000, () => {
        req.destroy();
        reject(new Error('Google API request timeout'));
      });
      req.end();
    });
  }
}
