// VS Code webview API type definitions

interface VsCodeApi {
  postMessage(message: any): void;
  setState(state: any): void;
  getState(): any;
}

declare function acquireVsCodeApi(): VsCodeApi;

// Backlog data interfaces
interface BacklogUser {
  id: number;
  name: string;
  roleType: number;
  lang: string;
  mailAddress: string;
}

interface BacklogStatus {
  id: number;
  name: string;
  color: string;
  displayOrder: number;
}

interface BacklogPriority {
  id: number;
  name: string;
}

interface BacklogIssue {
  id: number;
  projectId: number;
  issueKey: string;
  keyId: number;
  issueType: any;
  summary: string;
  description: string | null;
  resolution: any;
  priority: BacklogPriority;
  status: BacklogStatus;
  assignee: BacklogUser | null;
  category: any[];
  versions: any[];
  milestone: any[];
  startDate: string | null;
  dueDate: string | null;
  estimatedHours: number | null;
  actualHours: number | null;
  parentIssueId: number | null;
  createdUser: BacklogUser;
  created: string;
  updatedUser: BacklogUser;
  updated: string;
  customFields: any[];
  attachments: any[];
  sharedFiles: any[];
  stars: any[];
}

interface BacklogComment {
  id: number;
  content: string;
  changeLog: any[];
  createdUser: BacklogUser | null;
  created: string;
  updated: string;
  notifications: any[];
  stars: any[];
}
