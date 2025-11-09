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
      return `<img src="${safeHref}"${titleAttr}${altAttr} class="markdown-image">`;
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
  public renderMarkdown(content: string, attachments?: Array<{ id: number; name: string; dataUrl: string }>): string {
    if (!content) {
      return '<p class="no-content">No content available.</p>';
    }

    try {
      // Replace attachment references in markdown content before parsing
      let processedContent = content;
      if (attachments && attachments.length > 0) {
        processedContent = this.replaceAttachmentReferences(content, attachments);
      }

      // Parse and render markdown
      const result = marked.parse(processedContent);
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
   * Replace attachment references in markdown content with data URLs
   */
  private replaceAttachmentReferences(content: string, attachments: Array<{ id: number; name: string; dataUrl: string }>): string {
    let processed = content;

    // Replace Backlog attachment reference patterns
    attachments.forEach(attachment => {
      // Pattern: ![alt text](/document/.../file/123) - Backlog画像参照
      const imagePattern = new RegExp(`!\\[([^\\]]*)\\]\\([^)]*\\/file\\/${attachment.id}\\)`, 'g');
      processed = processed.replace(imagePattern, `![$1](${attachment.dataUrl})`);

      // Pattern: [link text](/document/.../file/123) - Backlogリンク参照
      const linkPattern = new RegExp(`\\[([^\\]]*)\\]\\([^)]*\\/file\\/${attachment.id}\\)`, 'g');
      processed = processed.replace(linkPattern, `[$1](${attachment.dataUrl})`);
    });

    return processed;
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
    if (!url) {
      return '#';
    }

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
      /* Enhanced Markdown content styles for better readability */
      .markdown-content {
        line-height: 1.7;
        font-family: var(--vscode-font-family);
        color: var(--vscode-foreground);
        font-size: 0.95rem;
        max-width: none;
      }

      /* Typography hierarchy with improved sizing */
      .markdown-content h1,
      .markdown-content h2,
      .markdown-content h3,
      .markdown-content h4,
      .markdown-content h5,
      .markdown-content h6 {
        color: var(--vscode-foreground);
        margin-top: 32px;
        margin-bottom: 20px;
        font-weight: 600;
        line-height: 1.3;
      }

      .markdown-content h1 {
        font-size: 1.75rem;
        border-bottom: 2px solid var(--vscode-panel-border);
        padding-bottom: 12px;
        margin-top: 0;
      }

      .markdown-content h2 {
        font-size: 1.5rem;
        border-bottom: 1px solid var(--vscode-panel-border);
        padding-bottom: 10px;
      }

      .markdown-content h3 {
        font-size: 1.25rem;
      }

      .markdown-content h4 {
        font-size: 1.1rem;
      }

      .markdown-content h5 {
        font-size: 1rem;
      }

      .markdown-content h6 {
        font-size: 0.95rem;
        color: var(--vscode-descriptionForeground);
      }

      /* Better paragraph spacing */
      .markdown-content p {
        margin-bottom: 20px;
        line-height: 1.7;
      }

      /* Enhanced list styles */
      .markdown-content ul,
      .markdown-content ol {
        margin-bottom: 20px;
        padding-left: 28px;
      }

      .markdown-content li {
        margin-bottom: 6px;
        line-height: 1.6;
      }

      .markdown-content ul li {
        list-style-type: disc;
      }

      .markdown-content ul ul li {
        list-style-type: circle;
      }

      .markdown-content ul ul ul li {
        list-style-type: square;
      }

      /* Task list items (checkboxes) with better styling */
      .markdown-content li.task-list-item {
        list-style: none;
        margin-left: -24px;
        display: flex;
        align-items: flex-start;
        gap: 12px;
      }

      .markdown-content li.task-list-item input[type="checkbox"] {
        margin: 0;
        margin-top: 4px;
        flex-shrink: 0;
        width: 16px;
        height: 16px;
        cursor: pointer;
      }

      .markdown-content li.task-list-item > p {
        margin: 0;
        flex: 1;
      }

      /* Enhanced blockquote styling */
      .markdown-content blockquote {
        margin: 24px 0;
        padding: 16px 20px;
        color: var(--vscode-descriptionForeground);
        border-left: 4px solid var(--vscode-textBlockQuote-border);
        background: var(--vscode-textBlockQuote-background);
        border-radius: 0 6px 6px 0;
        font-style: italic;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }

      .markdown-content blockquote p {
        margin-bottom: 12px;
      }

      .markdown-content blockquote p:last-child {
        margin-bottom: 0;
      }

      /* Better code styling */
      .markdown-content code {
        background: var(--vscode-textCodeBlock-background);
        color: var(--vscode-textPreformat-foreground);
        padding: 3px 6px;
        border-radius: 4px;
        font-family: var(--vscode-editor-font-family);
        font-size: 0.9em;
        border: 1px solid var(--vscode-panel-border);
      }

      .markdown-content pre {
        background: var(--vscode-textCodeBlock-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 8px;
        padding: 20px;
        overflow-x: auto;
        margin: 24px 0;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }

      .markdown-content pre code {
        background: none;
        padding: 0;
        border: none;
        font-size: 0.9rem;
        line-height: 1.5;
      }

      /* Enhanced table styling */
      .markdown-content .markdown-table {
        border-collapse: collapse;
        margin: 24px 0;
        width: 100%;
        border: 2px solid var(--vscode-panel-border);
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      }

      .markdown-content .markdown-table th,
      .markdown-content .markdown-table td {
        border: 1px solid var(--vscode-panel-border);
        padding: 12px 16px;
        text-align: left;
        vertical-align: top;
      }

      .markdown-content .markdown-table th {
        background: var(--vscode-editor-inactiveSelectionBackground);
        font-weight: 600;
        color: var(--vscode-foreground);
        border-bottom: 2px solid var(--vscode-panel-border);
      }

      .markdown-content .markdown-table tr:nth-child(even) {
        background: var(--vscode-editor-inactiveSelectionBackground);
      }

      .markdown-content .markdown-table tr:hover {
        background: var(--vscode-list-hoverBackground);
      }

      /* Enhanced image styling */
      .markdown-content img,
      .markdown-content .markdown-image {
        max-width: 100%;
        height: auto;
        margin: 24px 0;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        border: 1px solid var(--vscode-panel-border);
      }

      /* Enhanced link styling */
      .markdown-content a {
        color: var(--vscode-textLink-foreground);
        text-decoration: none;
        border-bottom: 1px solid transparent;
        transition: all 0.2s ease;
      }

      .markdown-content a:hover {
        color: var(--vscode-textLink-activeForeground);
        border-bottom-color: var(--vscode-textLink-activeForeground);
      }

      /* Horizontal rule styling */
      .markdown-content hr {
        border: none;
        height: 2px;
        background: linear-gradient(to right, transparent, var(--vscode-panel-border), transparent);
        margin: 32px 0;
      }

      /* Enhanced Backlog-specific styles */
      .issue-mention {
        background: var(--vscode-badge-background);
        color: var(--vscode-badge-foreground);
        padding: 3px 8px;
        border-radius: 12px;
        font-size: 0.85rem;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      .issue-mention:hover {
        background: var(--vscode-badge-foreground);
        color: var(--vscode-badge-background);
        transform: translateY(-1px);
      }

      .issue-mention::before {
        content: "🐛";
        font-size: 12px;
      }

      .user-mention {
        background: var(--vscode-button-secondaryBackground);
        color: var(--vscode-button-secondaryForeground);
        padding: 3px 8px;
        border-radius: 12px;
        font-size: 0.85rem;
        font-weight: 500;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        transition: all 0.2s ease;
      }

      .user-mention:hover {
        background: var(--vscode-button-secondaryHoverBackground);
        transform: translateY(-1px);
      }

      .user-mention::before {
        content: "👤";
        font-size: 12px;
      }

      /* Enhanced no-content styling */
      .no-content {
        color: var(--vscode-descriptionForeground);
        font-style: italic;
        text-align: center;
        padding: 40px 24px;
        background: var(--vscode-editor-inactiveSelectionBackground);
        border-radius: 8px;
        border: 2px dashed var(--vscode-panel-border);
        margin: 24px 0;
      }

      /* Enhanced error styling */
      .render-error {
        background: var(--vscode-inputValidation-errorBackground);
        border: 1px solid var(--vscode-inputValidation-errorBorder);
        border-radius: 8px;
        padding: 20px;
        margin: 24px 0;
        box-shadow: 0 2px 8px rgba(255,0,0,0.1);
      }

      .render-error p {
        color: var(--vscode-errorForeground);
        margin-bottom: 12px;
        font-weight: 500;
      }

      .render-error pre {
        background: var(--vscode-textCodeBlock-background);
        color: var(--vscode-foreground);
        max-height: 200px;
        overflow-y: auto;
        border-radius: 4px;
        margin-top: 12px;
      }

      /* Responsive adjustments */
      @media (max-width: 768px) {
        .markdown-content h1 {
          font-size: 1.5rem;
        }
        
        .markdown-content h2 {
          font-size: 1.3rem;
        }
        
        .markdown-content h3 {
          font-size: 1.1rem;
        }
      }
    `;
  }
}
