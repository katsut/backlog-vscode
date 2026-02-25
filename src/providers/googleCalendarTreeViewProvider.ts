import * as vscode from 'vscode';
import { GoogleApiService } from '../services/googleApi';
import { GoogleCalendarEvent, GoogleDriveFile } from '../types/google';

// ---- Tree Item Types ----

type GoogleCalendarTreeItem = DateGroupItem | EventItem | DocumentItem;

export class DateGroupItem extends vscode.TreeItem {
  constructor(
    public readonly dateKey: string, // YYYY-MM-DD
    public readonly displayLabel: string,
    public readonly isToday: boolean
  ) {
    super(
      displayLabel,
      isToday ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
    );
    this.contextValue = 'dateGroup';
    this.iconPath = new vscode.ThemeIcon('calendar');
  }
}

export class EventItem extends vscode.TreeItem {
  constructor(public readonly event: GoogleCalendarEvent, public readonly docCount?: number) {
    super(EventItem.buildLabel(event), vscode.TreeItemCollapsibleState.Collapsed);

    this.contextValue = 'calendarEvent';
    this.tooltip = EventItem.buildTooltip(event);
    this.description = EventItem.buildDescription(event, docCount);

    // Icon based on whether it has a Meet link
    this.iconPath = event.hangoutLink
      ? new vscode.ThemeIcon('device-camera-video')
      : new vscode.ThemeIcon('calendar');
  }

  private static buildLabel(event: GoogleCalendarEvent): string {
    const start = event.start.dateTime || event.start.date || '';
    if (event.start.dateTime) {
      const time = new Date(start);
      const hh = String(time.getHours()).padStart(2, '0');
      const mm = String(time.getMinutes()).padStart(2, '0');
      return `${hh}:${mm} ${event.summary || '(No title)'}`;
    }
    return event.summary || '(No title)';
  }

  private static buildDescription(event: GoogleCalendarEvent, docCount?: number): string {
    const parts: string[] = [];
    const attendeeCount = event.attendees?.filter((a) => !a.self).length || 0;
    if (attendeeCount > 0) {
      parts.push(`${attendeeCount} attendees`);
    }
    if (docCount !== undefined && docCount > 0) {
      parts.push(`${docCount} docs`);
    }
    return parts.join(' · ');
  }

  private static buildTooltip(event: GoogleCalendarEvent): string {
    const lines: string[] = [event.summary || '(No title)'];

    if (event.start.dateTime && event.end.dateTime) {
      const start = new Date(event.start.dateTime);
      const end = new Date(event.end.dateTime);
      const fmt = (d: Date) => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
      lines.push(`${fmt(start)} - ${fmt(end)}`);
    }

    if (event.attendees) {
      const names = event.attendees
        .filter((a) => !a.self)
        .map((a) => a.displayName || a.email)
        .slice(0, 10);
      if (names.length > 0) {
        lines.push(`Attendees: ${names.join(', ')}`);
      }
    }

    if (event.hangoutLink) {
      lines.push(`Meet: ${event.hangoutLink}`);
    }

    return lines.join('\n');
  }
}

export class DocumentItem extends vscode.TreeItem {
  constructor(
    public readonly file: GoogleDriveFile,
    public readonly event: GoogleCalendarEvent,
    extensionUri?: vscode.Uri
  ) {
    super(file.name, vscode.TreeItemCollapsibleState.None);

    this.contextValue = 'calendarDocument';
    this.tooltip = `${file.name}\n${file.mimeType}`;

    // Icon based on mime type
    if (extensionUri && file.mimeType === 'application/vnd.google-apps.document') {
      this.iconPath = {
        light: vscode.Uri.joinPath(extensionUri, 'media', 'google-docs-icon.svg'),
        dark: vscode.Uri.joinPath(extensionUri, 'media', 'google-docs-icon.svg'),
      };
    } else if (file.mimeType === 'application/vnd.google-apps.spreadsheet') {
      this.iconPath = new vscode.ThemeIcon('table');
    } else if (file.mimeType === 'application/vnd.google-apps.presentation') {
      this.iconPath = new vscode.ThemeIcon('preview');
    } else {
      this.iconPath = new vscode.ThemeIcon('file');
    }

    this.command = {
      command: 'nulab.treeItemClicked',
      title: 'Open Meeting Notes',
      arguments: ['nulab.google.openMeetingNotes', file, event],
    };
  }
}

// ---- TreeView Provider ----

export class GoogleCalendarTreeViewProvider
  implements vscode.TreeDataProvider<GoogleCalendarTreeItem>
{
  private _onDidChangeTreeData = new vscode.EventEmitter<
    GoogleCalendarTreeItem | undefined | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  // Cache: dateKey → events
  private eventCache: Map<string, GoogleCalendarEvent[]> = new Map();
  // Cache: eventId → documents
  private documentCache: Map<string, GoogleDriveFile[]> = new Map();
  private daysRange: number;

  constructor(private googleApi: GoogleApiService, private extensionUri: vscode.Uri) {
    this.daysRange =
      vscode.workspace.getConfiguration('nulab').get<number>('google.daysRange') || 7;
  }

  refresh(): void {
    this.eventCache.clear();
    this.documentCache.clear();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: GoogleCalendarTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: GoogleCalendarTreeItem): Promise<GoogleCalendarTreeItem[]> {
    if (!element) {
      return this.getDateGroups();
    }

    if (element instanceof DateGroupItem) {
      return this.getEventsForDate(element.dateKey);
    }

    if (element instanceof EventItem) {
      return this.getDocumentsForEvent(element.event);
    }

    return [];
  }

  // ---- Level 0: Date groups ----

  private getDateGroups(): DateGroupItem[] {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const groups: DateGroupItem[] = [];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    for (let offset = -this.daysRange; offset <= this.daysRange; offset++) {
      const date = new Date(today);
      date.setDate(date.getDate() + offset);

      const dateKey = formatDateKey(date);
      const dow = dayNames[date.getDay()];
      const month = date.getMonth() + 1;
      const day = date.getDate();
      const isToday = offset === 0;

      let label: string;
      if (offset === 0) {
        label = `Today — ${month}/${day} (${dow})`;
      } else if (offset === 1) {
        label = `Tomorrow — ${month}/${day} (${dow})`;
      } else if (offset === -1) {
        label = `Yesterday — ${month}/${day} (${dow})`;
      } else {
        label = `${month}/${day} (${dow})`;
      }

      groups.push(new DateGroupItem(dateKey, label, isToday));
    }

    return groups;
  }

  // ---- Level 1: Events for a date ----

  private async getEventsForDate(dateKey: string): Promise<EventItem[]> {
    if (!this.eventCache.has(dateKey)) {
      await this.fetchEventsForRange();
    }

    const events = this.eventCache.get(dateKey) || [];
    return events.map((e) => {
      const docCount = this.documentCache.has(e.id)
        ? this.documentCache.get(e.id)!.length
        : undefined;
      return new EventItem(e, docCount);
    });
  }

  private async fetchEventsForRange(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const timeMin = new Date(today);
    timeMin.setDate(timeMin.getDate() - this.daysRange);

    const timeMax = new Date(today);
    timeMax.setDate(timeMax.getDate() + this.daysRange + 1);

    try {
      const events = await this.googleApi.getEvents(timeMin.toISOString(), timeMax.toISOString());

      // Clear and populate cache grouped by date
      this.eventCache.clear();
      for (const event of events) {
        const startStr = event.start.dateTime || event.start.date || '';
        const date = new Date(startStr);
        const dateKey = formatDateKey(date);

        if (!this.eventCache.has(dateKey)) {
          this.eventCache.set(dateKey, []);
        }
        this.eventCache.get(dateKey)!.push(event);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('not configured')) {
        // Not authenticated — show empty tree, welcome view will be shown
        return;
      }
      console.error('Failed to fetch Google Calendar events:', error);
      vscode.window.showErrorMessage(
        `Google Calendar の取得に失敗しました: ${error instanceof Error ? error.message : error}`
      );
    }
  }

  // ---- Level 2: Documents for an event ----

  private async getDocumentsForEvent(event: GoogleCalendarEvent): Promise<DocumentItem[]> {
    if (!this.documentCache.has(event.id)) {
      try {
        const docs = await this.googleApi.getDocumentsForEvent(event);
        this.documentCache.set(event.id, docs);
      } catch (error) {
        console.error(`Failed to fetch documents for event ${event.id}:`, error);
        this.documentCache.set(event.id, []);
      }
    }

    const docs = this.documentCache.get(event.id) || [];
    return docs.map((doc) => new DocumentItem(doc, event, this.extensionUri));
  }
}

// ---- Utility ----

function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
