import * as vscode from 'vscode';
import { BacklogApiService } from '../services/backlogApi';

export class BacklogProjectsWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'backlogProjectsWebview';

  private _view?: vscode.WebviewView;
  private projects: any[] = [];
  private filteredProjects: any[] = [];
  private searchQuery: string = '';

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private backlogApi: BacklogApiService
  ) {
    this.loadProjects();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this._extensionUri
      ]
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'search':
          this.searchProjects(data.query);
          break;
        case 'selectProject':
          await this.selectProject(data.projectId);
          break;
        case 'refresh':
          await this.loadProjects();
          break;
      }
    });

    // 初期データを送信
    this.updateWebview();
  }

  private async searchProjects(query: string): Promise<void> {
    this.searchQuery = query.toLowerCase();
    this.applyFilters();
    this.updateWebview();
  }

  private async selectProject(projectId: number): Promise<void> {
    try {
      console.log('Selecting project with ID:', projectId);
      
      // プロジェクトフォーカスコマンドを実行
      console.log('Executing backlog.focusProject command...');
      await vscode.commands.executeCommand('backlog.focusProject', projectId);
      
      console.log('Project focus command completed successfully');
      
      // 成功メッセージを表示
      vscode.window.showInformationMessage(`Selected project: ${projectId}`);
      
    } catch (error) {
      console.error('Error focusing project:', error);
      vscode.window.showErrorMessage(`Failed to select project: ${error}`);
    }
  }

  private applyFilters(): void {
    let filtered = [...this.projects];

    if (this.searchQuery) {
      filtered = filtered.filter(project =>
        project.name.toLowerCase().includes(this.searchQuery) ||
        project.projectKey.toLowerCase().includes(this.searchQuery) ||
        (project.description && project.description.toLowerCase().includes(this.searchQuery))
      );
    }

    this.filteredProjects = filtered;
  }

  private async loadProjects(): Promise<void> {
    console.log('loadProjects called');
    
    const isConfigured = await this.backlogApi.isConfigured();
    console.log('API configured:', isConfigured);
    
    if (!isConfigured) {
      console.log('API not configured, showing empty projects');
      this.projects = [];
      this.applyFilters();
      this.updateWebview();
      return;
    }

    try {
      console.log('Loading projects for webview...');
      const projects = await this.backlogApi.getProjects();
      
      console.log('Raw projects from API:', projects);
      this.projects = projects || [];
      this.applyFilters();
      console.log('Projects loaded successfully:', this.projects.length, 'projects');
      console.log('Filtered projects:', this.filteredProjects.length);
      this.updateWebview();
    } catch (error) {
      console.error('Error loading projects:', error);
      console.error('Error details:', error);
      this.projects = [];
      this.applyFilters();
      this.updateWebview();
      
      // Webviewにエラーを表示
      if (this._view) {
        this._view.webview.postMessage({
          type: 'showError',
          error: `Failed to load projects: ${error}`
        });
      }
    }
  }

  public refresh(): void {
    this.loadProjects();
  }

  private updateWebview(): void {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'updateProjects',
        projects: this.filteredProjects,
        searchQuery: this.searchQuery
      });
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
    const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
    const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));

    const nonce = getNonce();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <link href="${styleResetUri}" rel="stylesheet">
          <link href="${styleVSCodeUri}" rel="stylesheet">
          <link href="${styleMainUri}" rel="stylesheet">
          <title>Backlog Projects</title>
      </head>
      <body>
          <div class="container">
              <div class="search-container">
                  <button id="refreshButton" class="refresh-button" title="Refresh">⟳</button>
                  <input type="text" id="searchInput" placeholder="Search projects..." class="search-input">
              </div>
              <div id="projectsList" class="projects-list">
                  <div class="loading">Loading projects...</div>
              </div>
          </div>

          <script nonce="${nonce}">
              const vscode = acquireVsCodeApi();
              const searchInput = document.getElementById('searchInput');
              const refreshButton = document.getElementById('refreshButton');
              const projectsList = document.getElementById('projectsList');

              let searchTimeout;

              // 検索入力の処理
              searchInput.addEventListener('input', (e) => {
                  clearTimeout(searchTimeout);
                  searchTimeout = setTimeout(() => {
                      vscode.postMessage({
                          type: 'search',
                          query: e.target.value
                      });
                  }, 300);
              });

              // リフレッシュボタンの処理
              refreshButton.addEventListener('click', () => {
                  vscode.postMessage({
                      type: 'refresh'
                  });
              });

              // プロジェクト選択の処理
              function selectProject(projectId) {
                  vscode.postMessage({
                      type: 'selectProject',
                      projectId: projectId
                  });
              }

              // メッセージハンドラ
              window.addEventListener('message', event => {
                  const message = event.data;
                  
                  switch (message.type) {
                      case 'updateProjects':
                          updateProjectsList(message.projects);
                          if (message.searchQuery !== searchInput.value) {
                              searchInput.value = message.searchQuery;
                          }
                          break;
                      case 'showError':
                          projectsList.innerHTML = \`<div class="error">Error: \${escapeHtml(message.error)}</div>\`;
                          break;
                  }
              });

              function updateProjectsList(projects) {
                  if (!projects || projects.length === 0) {
                      projectsList.innerHTML = '<div class="no-projects">No projects found</div>';
                      return;
                  }

                  // プロジェクトリストをクリア
                  projectsList.innerHTML = '';

                  // 各プロジェクトのDOM要素を作成
                  projects.forEach(project => {
                      const projectItem = document.createElement('div');
                      projectItem.className = 'project-item';
                      
                      projectItem.innerHTML = \`
                          <div class="project-name">\${escapeHtml(project.name)}</div>
                          <div class="project-key">\${escapeHtml(project.projectKey)}</div>
                          \${project.description ? \`<div class="project-description">\${escapeHtml(project.description)}</div>\` : ''}
                      \`;

                      // クリックイベントリスナーを追加
                      projectItem.addEventListener('click', () => {
                          console.log('Project clicked:', project.id, project.name);
                          selectProject(project.id);
                      });

                      // ダブルクリックイベントリスナーを追加
                      projectItem.addEventListener('dblclick', () => {
                          console.log('Project double-clicked:', project.id, project.name);
                          selectProject(project.id);
                      });

                      projectsList.appendChild(projectItem);
                  });
              }

              function escapeHtml(text) {
                  const map = {
                      '&': '&amp;',
                      '<': '&lt;',
                      '>': '&gt;',
                      '"': '&quot;',
                      "'": '&#039;'
                  };
                  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
              }
          </script>
      </body>
      </html>`;
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
