import { marked } from 'marked';

/**
 * Markdown rendering utility for Backlog documents
 */
export class MarkdownRenderer {
  private static instance: MarkdownRenderer | null = null;

  private constructor() {
    this.configureMarked();
  }

  public static getInstance(): MarkdownRenderer {
    if (!MarkdownRenderer.instance) {
      MarkdownRenderer.instance = new MarkdownRenderer();
    }
    return MarkdownRenderer.instance;
  }

  private configureMarked(): void {
    // Configure marked for secure rendering in webview
    marked.setOptions({
      gfm: true, // GitHub Flavored Markdown
      breaks: true, // Line breaks
    });

    // Custom renderer for security and VS Code integration
    const renderer = new marked.Renderer();

    // Override link rendering for security
    renderer.link = ({ href, title, text }): string => {
      const safeHref = this.sanitizeUrl(href);
      const titleAttr = title ? ` title="${this.escapeHtml(title)}"` : '';
      return `<a href="${safeHref}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    };

    // Override image rendering for security
    renderer.image = ({ href, title, text }): string => {
      const safeHref = this.sanitizeUrl(href);
      const titleAttr = title ? ` title="${this.escapeHtml(title)}"` : '';
      const altAttr = text ? ` alt="${this.escapeHtml(text)}"` : '';
      return `<img src="${safeHref}"${titleAttr}${altAttr} style="max-width: 100%; height: auto;">`;
    };

    // Custom code block rendering
    renderer.code = ({ text, lang }): string => {
      const language = lang || 'text';
      return `<pre><code class="language-${language}">${this.escapeHtml(text)}</code></pre>`;
    };

    // Table rendering with VS Code styling
    renderer.table = (token): string => {
      const header = token.header.map(cell => 
        `<th>${cell.text}</th>`
      ).join('');
      
      const body = token.rows.map(row => 
        `<tr>${row.map(cell => `<td>${cell.text}</td>`).join('')}</tr>`
      ).join('');

      return `<table class="markdown-table">
        <thead><tr>${header}</tr></thead>
        <tbody>${body}</tbody>
      </table>`;
    };

    marked.use({ renderer });
  }

  /**
   * Render markdown content to HTML
   */
  public renderMarkdown(content: string): string {
    if (!content) {
      return '<p class="no-content">No content available.</p>';
    }

    try {
      // Parse and render markdown
      const result = marked.parse(content);
      const html = typeof result === 'string' ? result : result.toString();
      
      // Additional post-processing for Backlog-specific features
      return this.processBacklogFeatures(html);
    } catch (error) {
      console.error('Markdown rendering error:', error);
      return `<div class="render-error">
        <p>Failed to render markdown content.</p>
        <pre>${this.escapeHtml(content)}</pre>
      </div>`;
    }
  }

  /**
   * Process Backlog-specific markdown features
   */
  private processBacklogFeatures(html: string): string {
    let processed = html;

    // Backlog issue mentions: #PROJ-123
    processed = processed.replace(
      /#([A-Z][A-Z0-9_]*-\d+)/g,
      '<span class="issue-mention" title="Issue: $1">#$1</span>'
    );

    // User mentions: @username
    processed = processed.replace(
      /@([a-zA-Z0-9_.-]+)/g,
      '<span class="user-mention" title="User: $1">@$1</span>'
    );

    // Backlog emoticons: (smile), (sad), etc.
    const emoticons: { [key: string]: string } = {
      '(smile)': '😊',
      '(sad)': '😢',
      '(wink)': '😉',
      '(tongue)': '😛',
      '(laugh)': '😄',
      '(cool)': '😎',
      '(angry)': '😠',
      '(surprised)': '😲',
      '(confused)': '😕',
      '(heart)': '❤️',
      '(star)': '⭐',
      '(thumbsup)': '👍',
      '(thumbsdown)': '👎'
    };

    Object.entries(emoticons).forEach(([emoticon, emoji]) => {
      const regex = new RegExp(this.escapeRegex(emoticon), 'g');
      processed = processed.replace(regex, emoji);
    });

    return processed;
  }

  /**
   * Escape HTML characters
   */
  private escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, (m) => map[m]);
  }

  /**
   * Sanitize URLs to prevent XSS
   */
  private sanitizeUrl(url: string): string {
    if (!url) return '#';
    
    // Allow http, https, and data URLs only
    const allowedProtocols = /^(https?:|data:|#)/i;
    
    if (allowedProtocols.test(url)) {
      return this.escapeHtml(url);
    }
    
    return '#';
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Get CSS styles for markdown rendering in webview
   */
  public getMarkdownStyles(): string {
    return `
      /* Markdown content styles */
      .markdown-content {
        line-height: 1.6;
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
      }

      .markdown-content h1,
      .markdown-content h2,
      .markdown-content h3,
      .markdown-content h4,
      .markdown-content h5,
      .markdown-content h6 {
        color: var(--vscode-foreground);
        margin-top: 24px;
        margin-bottom: 16px;
        font-weight: 600;
        line-height: 1.25;
      }

      .markdown-content h1 {
        font-size: 2em;
        border-bottom: 1px solid var(--vscode-panel-border);
        padding-bottom: 8px;
      }

      .markdown-content h2 {
        font-size: 1.5em;
        border-bottom: 1px solid var(--vscode-panel-border);
        padding-bottom: 8px;
      }

      .markdown-content h3 {
        font-size: 1.25em;
      }

      .markdown-content p {
        margin-bottom: 16px;
      }

      .markdown-content ul,
      .markdown-content ol {
        margin-bottom: 16px;
        padding-left: 24px;
      }

      .markdown-content li {
        margin-bottom: 4px;
      }

      /* Task list items (checkboxes) */
      .markdown-content li.task-list-item {
        list-style: none;
        margin-left: -20px;
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }

      .markdown-content li.task-list-item input[type="checkbox"] {
        margin: 0;
        margin-top: 2px;
        flex-shrink: 0;
      }

      .markdown-content li.task-list-item > p {
        margin: 0;
        flex: 1;
      }

      .markdown-content blockquote {
        margin: 16px 0;
        padding: 0 16px;
        color: var(--vscode-descriptionForeground);
        border-left: 4px solid var(--vscode-textBlockQuote-border);
        background: var(--vscode-textBlockQuote-background);
      }

      .markdown-content code {
        background: var(--vscode-textPreformat-background);
        color: var(--vscode-textPreformat-foreground);
        padding: 2px 4px;
        border-radius: 3px;
        font-family: var(--vscode-editor-font-family);
        font-size: 0.9em;
      }

      .markdown-content pre {
        background: var(--vscode-textCodeBlock-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 6px;
        padding: 16px;
        overflow-x: auto;
        margin: 16px 0;
      }

      .markdown-content pre code {
        background: none;
        padding: 0;
        font-size: inherit;
      }

      .markdown-content .markdown-table {
        border-collapse: collapse;
        margin: 16px 0;
        width: 100%;
      }

      .markdown-content .markdown-table th,
      .markdown-content .markdown-table td {
        border: 1px solid var(--vscode-panel-border);
        padding: 8px 12px;
        text-align: left;
      }

      .markdown-content .markdown-table th {
        background: var(--vscode-editor-inactiveSelectionBackground);
        font-weight: 600;
      }

      .markdown-content .markdown-table tr:nth-child(even) {
        background: var(--vscode-editor-inactiveSelectionBackground);
      }

      .markdown-content img {
        max-width: 100%;
        height: auto;
        margin: 16px 0;
        border-radius: 4px;
      }

      .markdown-content a {
        color: var(--vscode-textLink-foreground);
        text-decoration: none;
      }

      .markdown-content a:hover {
        color: var(--vscode-textLink-activeForeground);
        text-decoration: underline;
      }

      /* Backlog-specific styles */
      .issue-mention {
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        padding: 2px 6px;
        border-radius: 12px;
        font-size: 0.9em;
        font-weight: 500;
        cursor: pointer;
      }

      .user-mention {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        padding: 2px 6px;
        border-radius: 12px;
        font-size: 0.9em;
        font-weight: 500;
      }

      .no-content {
        color: var(--vscode-descriptionForeground);
        font-style: italic;
        text-align: center;
        padding: 20px;
      }

      .render-error {
        background: var(--vscode-inputValidation-errorBackground);
        border: 1px solid var(--vscode-inputValidation-errorBorder);
        border-radius: 4px;
        padding: 16px;
        margin: 16px 0;
      }

      .render-error p {
        color: var(--vscode-errorForeground);
        margin-bottom: 8px;
      }

      .render-error pre {
        background: var(--vscode-textCodeBlock-background);
        color: var(--vscode-foreground);
        max-height: 200px;
        overflow-y: auto;
      }
    `;
  }
}
