import { LocalIndex } from 'vectra';
import * as path from 'path';
import * as fs from 'fs';
import type { SearchResult, ChunkMetadata } from '../types.js';

interface SearchOptions {
  types?: string[];
  project?: string;
  limit?: number;
}

export class VectorStore {
  private basePath: string;
  private indexes = new Map<string, LocalIndex>();

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  private getIndexPath(name: string): string {
    return path.join(this.basePath, 'vectors', name);
  }

  async getOrCreateIndex(name: string): Promise<LocalIndex> {
    if (this.indexes.has(name)) {
      return this.indexes.get(name)!;
    }

    const indexPath = this.getIndexPath(name);
    const index = new LocalIndex(indexPath);

    if (!(await index.isIndexCreated())) {
      fs.mkdirSync(indexPath, { recursive: true });
      await index.createIndex();
    }

    this.indexes.set(name, index);
    return index;
  }

  /** Delete and recreate an index (fast full rebuild) */
  async resetIndex(name: string): Promise<void> {
    const indexPath = this.getIndexPath(name);
    if (fs.existsSync(indexPath)) {
      fs.rmSync(indexPath, { recursive: true });
    }
    this.indexes.delete(name);
    await this.getOrCreateIndex(name);
  }

  /** Insert without existence check (use after resetIndex) */
  async insertItem(
    indexName: string,
    id: string,
    vector: number[],
    text: string,
    metadata: ChunkMetadata
  ): Promise<void> {
    const index = await this.getOrCreateIndex(indexName);
    await index.insertItem({
      id,
      vector,
      metadata: { ...metadata, text },
    });
  }

  async upsertItem(
    indexName: string,
    id: string,
    vector: number[],
    text: string,
    metadata: ChunkMetadata
  ): Promise<void> {
    const index = await this.getOrCreateIndex(indexName);

    // Check if item exists
    const existing = await index.getItem(id);
    if (existing) {
      await index.upsertItem({
        id,
        vector,
        metadata: { ...metadata, text },
      });
    } else {
      await index.insertItem({
        id,
        vector,
        metadata: { ...metadata, text },
      });
    }
  }

  async deleteItem(indexName: string, id: string): Promise<void> {
    const index = await this.getOrCreateIndex(indexName);
    const existing = await index.getItem(id);
    if (existing) {
      await index.deleteItem(id);
    }
  }

  async deleteByPrefix(indexName: string, prefix: string): Promise<void> {
    const index = await this.getOrCreateIndex(indexName);
    const items = await index.listItems();
    for (const item of items) {
      if (item.id.startsWith(prefix)) {
        await index.deleteItem(item.id);
      }
    }
  }

  async search(
    queryVector: number[],
    options: SearchOptions = {}
  ): Promise<SearchResult[]> {
    const { types, project, limit = 10 } = options;

    const indexNames = types || ['documents', 'issues', 'wiki'];
    const allResults: SearchResult[] = [];

    for (const indexName of indexNames) {
      const indexPath = this.getIndexPath(indexName);
      if (!fs.existsSync(indexPath)) continue;

      const index = await this.getOrCreateIndex(indexName);

      const results = await index.queryItems(queryVector, limit * 2);

      for (const result of results) {
        const meta = result.item.metadata as ChunkMetadata & { text: string };
        if (project && meta.project !== project) continue;

        allResults.push({
          content: meta.text || '',
          metadata: {
            id: meta.id,
            type: meta.type,
            project: meta.project,
            title: meta.title,
            sourceId: meta.sourceId,
            chunkIndex: meta.chunkIndex,
            url: meta.url,
          },
          score: result.score,
        });
      }
    }

    // Sort by score descending
    allResults.sort((a, b) => b.score - a.score);
    return allResults.slice(0, limit);
  }

  async searchByMetadata(
    indexName: string,
    filter: Partial<ChunkMetadata>
  ): Promise<SearchResult[]> {
    const indexPath = this.getIndexPath(indexName);
    if (!fs.existsSync(indexPath)) return [];

    const index = await this.getOrCreateIndex(indexName);
    const items = await index.listItems();
    const results: SearchResult[] = [];

    for (const item of items) {
      const meta = item.metadata as ChunkMetadata & { text: string };
      let matches = true;
      for (const [key, value] of Object.entries(filter)) {
        if (meta[key] !== value) {
          matches = false;
          break;
        }
      }
      if (matches) {
        results.push({
          content: meta.text || '',
          metadata: {
            id: meta.id,
            type: meta.type,
            project: meta.project,
            title: meta.title,
            sourceId: meta.sourceId,
            chunkIndex: meta.chunkIndex,
            url: meta.url,
          },
          score: 1.0,
        });
      }
    }

    return results;
  }
}
