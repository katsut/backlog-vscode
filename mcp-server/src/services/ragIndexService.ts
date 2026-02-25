import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Backlog } from 'backlog-js';
import type { Entity, Option } from 'backlog-js';
import { EmbeddingService } from './embeddingService.js';
import { VectorStore } from './vectorStore.js';
import { GraphStore } from './graphStore.js';
import { chunkByHeadings, chunkByParagraphs } from '../utils/chunker.js';
import type { RAGConfig, RAGManifest, ChunkMetadata } from '../types.js';
import type { Chunk } from '../utils/chunker.js';

interface IndexResult {
  project: string;
  issues: { indexed: number; skipped: number; deleted: number };
  documents: { indexed: number; skipped: number; deleted: number };
}

/** Pending item collected during Fetch phase */
interface PendingItem {
  itemId: string;
  type: 'issue' | 'document';
  project: string;
  title: string;
  sourceId: string;
  url: string;
  contentHash: string;
  chunks: Chunk[];
}

export class RAGIndexService {
  private config: RAGConfig;
  private embedding: EmbeddingService;
  private vectorStore: VectorStore;
  private graphStore: GraphStore;
  private backlog: Backlog | null = null;

  constructor(
    config: RAGConfig,
    embedding: EmbeddingService,
    vectorStore: VectorStore,
    graphStore: GraphStore
  ) {
    this.config = config;
    this.embedding = embedding;
    this.vectorStore = vectorStore;
    this.graphStore = graphStore;
  }

  private getBacklog(): Backlog {
    if (!this.backlog) {
      let host = this.config.domain;
      if (host.startsWith('https://')) host = host.replace('https://', '');
      if (host.startsWith('http://')) host = host.replace('http://', '');
      host = host.split('/')[0];
      this.backlog = new Backlog({ host, apiKey: this.config.apiKey });
    }
    return this.backlog;
  }

  async indexProjects(
    projectKeys: string[],
    rebuild: boolean = false
  ): Promise<IndexResult[]> {
    const manifest = rebuild ? this.createEmptyManifest() : this.loadManifest();
    const results: IndexResult[] = [];

    // Check if model changed → force rebuild
    if (manifest.model !== this.config.model) {
      console.error(
        `Model changed from ${manifest.model} to ${this.config.model}. Forcing rebuild.`
      );
      Object.keys(manifest.items).forEach((k) => delete manifest.items[k]);
    }
    manifest.model = this.config.model;

    const backlog = this.getBacklog();
    const projects = await backlog.getProjects();

    for (const projectKey of projectKeys) {
      const project = projects.find(
        (p) => p.projectKey.toUpperCase() === projectKey.toUpperCase()
      );
      if (!project) {
        console.error(`Project ${projectKey} not found, skipping.`);
        continue;
      }

      console.error(`Indexing project: ${projectKey} (${project.name})`);
      const result: IndexResult = {
        project: projectKey,
        issues: { indexed: 0, skipped: 0, deleted: 0 },
        documents: { indexed: 0, skipped: 0, deleted: 0 },
      };

      // ---- Phase 1: Fetch all data from API ----
      console.error(`  [Phase 1] Fetching data from Backlog API...`);

      const {
        pending: issuePending,
        graph,
        issueRemoteIds,
      } = await this.fetchIssues(project, manifest, result);

      const {
        pending: docPending,
        docRemoteIds,
      } = await this.fetchDocuments(project, manifest, result);

      const allPending = [...issuePending, ...docPending];
      console.error(`  [Phase 1] Done: ${allPending.length} items to embed (${issuePending.length} issues, ${docPending.length} documents)`);

      // ---- Phase 2: Batch embed all chunks ----
      console.error(`  [Phase 2] Embedding all chunks...`);
      await this.embedding.ensureInitialized();

      const allTexts: string[] = [];
      const chunkMap: Array<{ pendingIdx: number; chunkIdx: number }> = [];
      for (let pi = 0; pi < allPending.length; pi++) {
        for (let ci = 0; ci < allPending[pi].chunks.length; ci++) {
          allTexts.push(allPending[pi].chunks[ci].text);
          chunkMap.push({ pendingIdx: pi, chunkIdx: ci });
        }
      }

      const allVectors = allTexts.length > 0
        ? await this.embedding.embed(allTexts)
        : [];
      console.error(`  [Phase 2] Done: ${allVectors.length} vectors generated`);

      // ---- Phase 3: Store vectors + build graph ----
      console.error(`  [Phase 3] Storing vectors and building graph...`);
      const issueEmbeddings = new Map<string, number[]>();

      // Assign vectors back to pending items
      const pendingVectors: number[][][] = allPending.map((p) =>
        new Array(p.chunks.length)
      );
      for (let vi = 0; vi < chunkMap.length; vi++) {
        const { pendingIdx, chunkIdx } = chunkMap[vi];
        pendingVectors[pendingIdx][chunkIdx] = allVectors[vi];
      }

      for (let pi = 0; pi < allPending.length; pi++) {
        const item = allPending[pi];
        const vectors = pendingVectors[pi];
        const indexName = item.type === 'issue' ? 'issues' : 'documents';

        // Store first chunk's vector for semantic edges (issues only)
        if (item.type === 'issue' && vectors.length > 0) {
          issueEmbeddings.set(item.itemId, vectors[0]);
        }

        // Delete old chunks
        await this.vectorStore.deleteByPrefix(indexName, `${item.itemId}:`);

        // Insert new chunks
        for (let ci = 0; ci < item.chunks.length; ci++) {
          const chunkId = `${item.itemId}:${ci}`;
          const metadata: ChunkMetadata = {
            id: chunkId,
            type: item.type,
            project: item.project,
            title: item.title,
            sourceId: item.sourceId,
            chunkIndex: ci,
            url: item.url,
          };
          await this.vectorStore.upsertItem(
            indexName,
            chunkId,
            vectors[ci],
            item.chunks[ci].text,
            metadata
          );
        }

        manifest.items[item.itemId] = {
          type: item.type,
          project: item.project,
          content_hash: item.contentHash,
          indexed_at: new Date().toISOString(),
          chunk_count: item.chunks.length,
        };

        if (item.type === 'issue') result.issues.indexed++;
        else result.documents.indexed++;
      }

      // Delete stale items
      for (const [itemId, entry] of Object.entries(manifest.items)) {
        if (entry.project !== projectKey) continue;
        if (entry.type === 'issue' && !issueRemoteIds.has(itemId)) {
          await this.vectorStore.deleteByPrefix('issues', `${itemId}:`);
          delete manifest.items[itemId];
          result.issues.deleted++;
        }
        if (entry.type === 'document' && !docRemoteIds.has(itemId)) {
          await this.vectorStore.deleteByPrefix('documents', `${itemId}:`);
          delete manifest.items[itemId];
          result.documents.deleted++;
        }
      }

      // Semantic edges
      if (issueEmbeddings.size > 1) {
        console.error(`  [Phase 3] Computing semantic edges for ${issueEmbeddings.size} issues...`);
        this.graphStore.addSemanticEdges(graph, issueEmbeddings, 0.7, 5);
      }

      graph.updatedAt = new Date().toISOString();
      this.graphStore.save(graph);

      console.error(`  [Phase 3] Done`);
      console.error(`  Issues: indexed=${result.issues.indexed}, skipped=${result.issues.skipped}, deleted=${result.issues.deleted}`);
      console.error(`  Documents: indexed=${result.documents.indexed}, skipped=${result.documents.skipped}, deleted=${result.documents.deleted}`);

      results.push(result);
    }

    manifest.indexed_at = new Date().toISOString();
    this.saveManifest(manifest);

    return results;
  }

  // ---- Fetch: Issues ----

  private async fetchIssues(
    project: Entity.Project.Project,
    manifest: RAGManifest,
    result: IndexResult
  ): Promise<{
    pending: PendingItem[];
    graph: ReturnType<GraphStore['createEmpty']>;
    issueRemoteIds: Set<string>;
  }> {
    const backlog = this.getBacklog();
    const projectKey = project.projectKey;
    const graph = this.graphStore.createEmpty(projectKey);
    const pending: PendingItem[] = [];
    const issueRemoteIds = new Set<string>();

    // Fetch latest issues (paginated, max 1000)
    let offset = 0;
    const batchSize = 100;
    const maxIssues = 1000;
    const allIssues: Entity.Issue.Issue[] = [];

    while (allIssues.length < maxIssues) {
      const issues = await backlog.getIssues({
        projectId: [project.id],
        count: Math.min(batchSize, maxIssues - allIssues.length),
        offset,
        sort: 'updated',
        order: 'desc',
      } as Option.Issue.GetIssuesParams);

      if (!issues || issues.length === 0) break;
      allIssues.push(...issues);
      offset += issues.length;

      if (issues.length < batchSize) break;
      await this.delay(200);
    }

    console.error(`    Issues: ${allIssues.length} fetched`);

    for (const issue of allIssues) {
      const itemId = `issue:${issue.issueKey}`;
      issueRemoteIds.add(itemId);

      // Build graph node
      this.graphStore.addNode(graph, {
        id: itemId,
        type: 'Issue',
        props: {
          key: issue.issueKey,
          summary: issue.summary,
          status: issue.status?.name,
          priority: issue.priority?.name,
          updated: issue.updated,
          created: issue.created,
          dueDate: issue.dueDate,
        },
      });

      // Add graph edges
      if (issue.assignee) {
        const userId = `user:${issue.assignee.userId || issue.assignee.id}`;
        this.graphStore.addNode(graph, {
          id: userId,
          type: 'User',
          props: { name: issue.assignee.name, userId: issue.assignee.userId },
        });
        this.graphStore.addEdge(graph, { source: itemId, target: userId, type: 'assignedTo' });
      }

      if (issue.createdUser) {
        const userId = `user:${issue.createdUser.userId || issue.createdUser.id}`;
        this.graphStore.addNode(graph, {
          id: userId,
          type: 'User',
          props: { name: issue.createdUser.name, userId: issue.createdUser.userId },
        });
        this.graphStore.addEdge(graph, { source: itemId, target: userId, type: 'createdBy' });
      }

      if (issue.parentIssueId) {
        this.graphStore.addEdge(graph, {
          source: itemId,
          target: `issue:${projectKey}-${issue.parentIssueId}`,
          type: 'childOf',
        });
      }

      if (issue.milestone) {
        for (const ms of issue.milestone) {
          const msId = `milestone:${ms.id}`;
          this.graphStore.addNode(graph, {
            id: msId,
            type: 'Milestone',
            props: { name: ms.name, releaseDueDate: ms.releaseDueDate },
          });
          this.graphStore.addEdge(graph, { source: itemId, target: msId, type: 'milestoneOf' });
        }
      }

      if (issue.category) {
        for (const cat of issue.category) {
          const catId = `category:${cat.id}`;
          this.graphStore.addNode(graph, {
            id: catId,
            type: 'Category',
            props: { name: cat.name },
          });
          this.graphStore.addEdge(graph, { source: itemId, target: catId, type: 'categorizedAs' });
        }
      }

      if (issue.status) {
        const statusId = `status:${issue.status.id}`;
        this.graphStore.addNode(graph, {
          id: statusId,
          type: 'Status',
          props: { name: issue.status.name },
        });
        this.graphStore.addEdge(graph, { source: itemId, target: statusId, type: 'statusIs' });
      }

      if (issue.issueType) {
        const typeId = `issuetype:${issue.issueType.id}`;
        this.graphStore.addNode(graph, {
          id: typeId,
          type: 'IssueType',
          props: { name: issue.issueType.name },
        });
        this.graphStore.addEdge(graph, { source: itemId, target: typeId, type: 'typeIs' });
      }

      // Check if content changed
      const content = `${issue.summary}\n\n${issue.description || ''}`;
      const contentHash = this.computeHash(content);

      if (manifest.items[itemId]?.content_hash === contentHash) {
        result.issues.skipped++;
        continue;
      }

      const chunks = chunkByParagraphs(content, 500);
      if (chunks.length === 0) {
        result.issues.skipped++;
        continue;
      }

      pending.push({
        itemId,
        type: 'issue',
        project: projectKey,
        title: issue.summary,
        sourceId: issue.issueKey,
        url: `https://${this.config.domain}/view/${issue.issueKey}`,
        contentHash,
        chunks,
      });
    }

    return { pending, graph, issueRemoteIds };
  }

  // ---- Fetch: Documents ----

  private async fetchDocuments(
    project: Entity.Project.Project,
    manifest: RAGManifest,
    result: IndexResult
  ): Promise<{
    pending: PendingItem[];
    docRemoteIds: Set<string>;
  }> {
    const backlog = this.getBacklog();
    const projectKey = project.projectKey;
    const pending: PendingItem[] = [];
    const docRemoteIds = new Set<string>();

    let tree: Entity.Document.DocumentTree;
    try {
      tree = await backlog.getDocumentTree(project.id);
    } catch (error) {
      console.error(`    Documents: not available (${error instanceof Error ? error.message : error})`);
      return { pending, docRemoteIds };
    }

    const nodes = this.flattenDocTree(tree.activeTree?.children || []);
    console.error(`    Documents: ${nodes.length} found`);

    for (const node of nodes) {
      const itemId = `doc:${node.id}`;
      docRemoteIds.add(itemId);

      let doc: Entity.Document.Document;
      try {
        doc = await backlog.getDocument(node.id);
      } catch {
        result.documents.skipped++;
        continue;
      }

      const content = doc.plain || '';
      if (!content.trim()) {
        result.documents.skipped++;
        continue;
      }

      const contentHash = this.computeHash(content);
      if (manifest.items[itemId]?.content_hash === contentHash) {
        result.documents.skipped++;
        continue;
      }

      const chunks = chunkByHeadings(content, 500);
      if (chunks.length === 0) {
        result.documents.skipped++;
        continue;
      }

      pending.push({
        itemId,
        type: 'document',
        project: projectKey,
        title: doc.title || node.name || node.id,
        sourceId: node.id,
        url: `https://${this.config.domain}/document/${projectKey}/${node.id}`,
        contentHash,
        chunks,
      });

      await this.delay(100);
    }

    return { pending, docRemoteIds };
  }

  // ---- Helpers ----

  private flattenDocTree(
    nodes: Entity.Document.DocumentTreeNode[]
  ): Entity.Document.DocumentTreeNode[] {
    const results: Entity.Document.DocumentTreeNode[] = [];
    for (const node of nodes) {
      results.push(node);
      if (node.children && node.children.length > 0) {
        results.push(...this.flattenDocTree(node.children));
      }
    }
    return results;
  }

  private computeHash(content: string): string {
    return createHash('sha256').update(content, 'utf-8').digest('hex');
  }

  private loadManifest(): RAGManifest {
    const manifestPath = path.join(this.config.basePath, 'manifest.json');
    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      return JSON.parse(content) as RAGManifest;
    } catch {
      return this.createEmptyManifest();
    }
  }

  private createEmptyManifest(): RAGManifest {
    return {
      version: 1,
      model: this.config.model,
      indexed_at: '',
      items: {},
    };
  }

  private saveManifest(manifest: RAGManifest): void {
    const manifestPath = path.join(this.config.basePath, 'manifest.json');
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
