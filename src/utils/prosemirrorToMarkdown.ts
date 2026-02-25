/**
 * Convert ProseMirror JSON to Markdown.
 * Handles common node types used by Backlog Documents.
 */

interface ProseMirrorNode {
  type?: string;
  text?: string;
  content?: ProseMirrorNode[];
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface ImageReference {
  src: string;
  alt: string;
  attachmentId: number | null;
}

/**
 * Convert ProseMirror JSON to Markdown string.
 * Also extracts image references for local download.
 */
export function proseMirrorToMarkdown(
  node: ProseMirrorNode,
  imageResolver?: (src: string) => string
): { markdown: string; images: ImageReference[] } {
  const images: ImageReference[] = [];
  const markdown = convertNode(node, images, imageResolver, '');
  return { markdown: markdown.replace(/\n{3,}/g, '\n\n').trim(), images };
}

function convertNode(
  node: ProseMirrorNode,
  images: ImageReference[],
  imageResolver: ((src: string) => string) | undefined,
  listPrefix: string
): string {
  if (!node) {
    return '';
  }

  // Text node
  if (typeof node.text === 'string') {
    return applyMarks(node.text, node.marks || []);
  }

  const children = node.content || [];

  switch (node.type) {
    case 'doc':
      return children.map((c) => convertNode(c, images, imageResolver, '')).join('');

    case 'paragraph': {
      const text = children.map((c) => convertNode(c, images, imageResolver, '')).join('');
      return text + '\n\n';
    }

    case 'heading': {
      const level = (node.attrs?.level as number) || 1;
      const prefix = '#'.repeat(Math.min(Math.max(level, 1), 6));
      const text = children.map((c) => convertNode(c, images, imageResolver, '')).join('');
      return `${prefix} ${text}\n\n`;
    }

    case 'bulletList':
      return children.map((c) => convertNode(c, images, imageResolver, '- ')).join('') + '\n';

    case 'orderedList': {
      const start = (node.attrs?.start as number) || 1;
      return (
        children.map((c, i) => convertNode(c, images, imageResolver, `${start + i}. `)).join('') +
        '\n'
      );
    }

    case 'listItem': {
      const inner = children.map((c) => convertNode(c, images, imageResolver, '')).join('');
      // Remove trailing double newline from paragraphs inside list items
      const trimmed = inner.replace(/\n\n$/, '\n');
      // Indent continuation lines
      const lines = trimmed.split('\n');
      const indented = lines
        .map((line, i) => (i === 0 ? listPrefix + line : '  ' + line))
        .join('\n');
      return indented;
    }

    case 'blockquote': {
      const inner = children.map((c) => convertNode(c, images, imageResolver, '')).join('');
      const lines = inner.trimEnd().split('\n');
      return lines.map((line) => `> ${line}`).join('\n') + '\n\n';
    }

    case 'codeBlock': {
      const language = (node.attrs?.language as string) || '';
      const code = children.map((c) => c.text || '').join('');
      return `\`\`\`${language}\n${code}\n\`\`\`\n\n`;
    }

    case 'image': {
      const src = (node.attrs?.src as string) || '';
      const alt = (node.attrs?.alt as string) || '';
      if (!src) {
        return '';
      }

      // Extract attachment ID
      const idMatch = src.match(/\/file\/(\d+)/);
      const attachmentId = idMatch ? Number(idMatch[1]) : null;
      images.push({ src, alt, attachmentId });

      // Use resolved path if resolver provided, otherwise original src
      const resolvedSrc = imageResolver ? imageResolver(src) : src;
      return `![${alt}](${resolvedSrc})\n\n`;
    }

    case 'hardBreak':
      return '\n';

    case 'horizontalRule':
      return '---\n\n';

    case 'table':
      return convertTable(node, images, imageResolver);

    default:
      // Unknown node - process children
      return children.map((c) => convertNode(c, images, imageResolver, '')).join('');
  }
}

function convertTable(
  tableNode: ProseMirrorNode,
  images: ImageReference[],
  imageResolver: ((src: string) => string) | undefined
): string {
  const rows = tableNode.content || [];
  if (rows.length === 0) {
    return '';
  }

  const tableData: string[][] = [];
  let isFirstRowHeader = false;

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const cells: string[] = [];
    if (row.content) {
      for (const cell of row.content) {
        if (ri === 0 && cell.type === 'tableHeader') {
          isFirstRowHeader = true;
        }
        const text = (cell.content || [])
          .map((c) => convertNode(c, images, imageResolver, ''))
          .join('')
          .replace(/\n+/g, ' ')
          .trim();
        cells.push(text);
      }
    }
    tableData.push(cells);
  }

  if (tableData.length === 0) {
    return '';
  }

  const maxCols = Math.max(...tableData.map((r) => r.length));
  let md = '';

  // Header row
  const header = tableData[0] || [];
  md += '| ' + Array.from({ length: maxCols }, (_, i) => header[i] || '').join(' | ') + ' |\n';
  md += '| ' + Array.from({ length: maxCols }, () => '---').join(' | ') + ' |\n';

  // Data rows
  const startRow = isFirstRowHeader ? 1 : 0;
  if (!isFirstRowHeader) {
    // Re-output first row as data
    md = '| ' + Array.from({ length: maxCols }, () => '').join(' | ') + ' |\n';
    md += '| ' + Array.from({ length: maxCols }, () => '---').join(' | ') + ' |\n';
    md += '| ' + Array.from({ length: maxCols }, (_, i) => header[i] || '').join(' | ') + ' |\n';
  }

  for (let ri = startRow; ri < tableData.length; ri++) {
    const row = tableData[ri];
    md += '| ' + Array.from({ length: maxCols }, (_, i) => row[i] || '').join(' | ') + ' |\n';
  }

  return md + '\n';
}

function applyMarks(
  text: string,
  marks: Array<{ type: string; attrs?: Record<string, unknown> }>
): string {
  let result = text;
  for (const mark of marks) {
    switch (mark.type) {
      case 'strong':
        result = `**${result}**`;
        break;
      case 'em':
        result = `*${result}*`;
        break;
      case 'code':
        result = `\`${result}\``;
        break;
      case 'strike':
        result = `~~${result}~~`;
        break;
      case 'link': {
        const href = (mark.attrs?.href as string) || '';
        result = `[${result}](${href})`;
        break;
      }
      // underline has no standard markdown, leave as is
    }
  }
  return result;
}
