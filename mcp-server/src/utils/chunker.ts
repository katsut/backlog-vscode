/**
 * Estimate token count for text.
 * Japanese characters are roughly 1-2 tokens each in most tokenizers.
 * ASCII words are roughly 1 token per word.
 */
export function estimateTokens(text: string): number {
  let count = 0;
  for (const char of text) {
    if (char.charCodeAt(0) > 0x7f) {
      // CJK characters: ~1.5 tokens per character on average
      count += 1.5;
    } else if (char === ' ' || char === '\n' || char === '\t') {
      // whitespace separator
      count += 0.25;
    } else {
      // ASCII: ~0.25 tokens per character (roughly 4 chars per token)
      count += 0.25;
    }
  }
  return Math.ceil(count);
}

export interface Chunk {
  text: string;
  index: number;
}

/**
 * Split text by markdown headings (## or ###), keeping each section as a chunk.
 * If a section exceeds maxTokens, further split by paragraphs.
 */
export function chunkByHeadings(
  text: string,
  maxTokens: number = 500
): Chunk[] {
  if (!text.trim()) return [];

  // Split by heading lines
  const sections: string[] = [];
  const lines = text.split('\n');
  let current: string[] = [];

  for (const line of lines) {
    if (/^#{1,3}\s/.test(line) && current.length > 0) {
      sections.push(current.join('\n').trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    sections.push(current.join('\n').trim());
  }

  const chunks: Chunk[] = [];
  let index = 0;

  for (const section of sections) {
    if (!section) continue;

    if (estimateTokens(section) <= maxTokens) {
      chunks.push({ text: section, index: index++ });
    } else {
      // Section too large, split by paragraphs
      const subChunks = chunkByParagraphs(section, maxTokens);
      for (const sub of subChunks) {
        chunks.push({ text: sub.text, index: index++ });
      }
    }
  }

  return chunks;
}

/**
 * Split text by paragraphs (double newlines), merging small paragraphs
 * to approach the maxTokens limit.
 */
export function chunkByParagraphs(
  text: string,
  maxTokens: number = 500
): Chunk[] {
  if (!text.trim()) return [];

  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
  const chunks: Chunk[] = [];
  let current: string[] = [];
  let currentTokens = 0;
  let index = 0;

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);

    if (currentTokens + paraTokens > maxTokens && current.length > 0) {
      chunks.push({ text: current.join('\n\n').trim(), index: index++ });
      current = [];
      currentTokens = 0;
    }

    // If a single paragraph exceeds maxTokens, split by sentences
    if (paraTokens > maxTokens) {
      if (current.length > 0) {
        chunks.push({ text: current.join('\n\n').trim(), index: index++ });
        current = [];
        currentTokens = 0;
      }
      const sentenceChunks = chunkBySentences(para, maxTokens);
      for (const sc of sentenceChunks) {
        chunks.push({ text: sc.text, index: index++ });
      }
    } else {
      current.push(para);
      currentTokens += paraTokens;
    }
  }

  if (current.length > 0) {
    chunks.push({ text: current.join('\n\n').trim(), index: index++ });
  }

  return chunks;
}

/**
 * Split text by sentences as a last resort for very long paragraphs.
 */
function chunkBySentences(text: string, maxTokens: number): Chunk[] {
  // Japanese sentence endings: 。！？, English: . ! ?
  const sentences = text.split(/(?<=[。！？.!?\n])\s*/);
  const chunks: Chunk[] = [];
  let current: string[] = [];
  let currentTokens = 0;
  let index = 0;

  for (const sentence of sentences) {
    const tokens = estimateTokens(sentence);

    if (currentTokens + tokens > maxTokens && current.length > 0) {
      chunks.push({ text: current.join('').trim(), index: index++ });
      current = [];
      currentTokens = 0;
    }

    current.push(sentence);
    currentTokens += tokens;
  }

  if (current.length > 0) {
    chunks.push({ text: current.join('').trim(), index: index++ });
  }

  return chunks;
}
