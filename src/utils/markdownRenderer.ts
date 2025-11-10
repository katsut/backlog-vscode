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
    // Configure marked for secure rendering in webview with task list support
    marked.setOptions({
      gfm: true, // GitHub Flavored Markdown (includes task lists)
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
   * Process Backlog-specific features (mentions and emoticons)
   * Task lists are handled by marked.js with GFM support
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

    // Backlog emoticons
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
   * @deprecated Markdown styles are now loaded from external CSS file (media/markdown.css)
   */
  public getMarkdownStyles(): string {
    return '/* Markdown styles are now loaded from external CSS file */';
  }
}
