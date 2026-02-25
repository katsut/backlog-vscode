#!/usr/bin/env node

/**
 * CLI for Backlog RAG indexing.
 *
 * Usage:
 *   node dist/cli.js fetch              # Fetch data from Backlog API → .backlog/fetched.json
 *   node dist/cli.js embed              # Embed fetched chunks → .backlog/embedded.json
 *   node dist/cli.js store              # Store vectors + build graph
 *   node dist/cli.js run                # Run all 3 phases sequentially
 *
 * Environment variables (auto-loaded from .env):
 *   BACKLOG_DOMAIN, BACKLOG_API_KEY, BACKLOG_PROJECTS (comma-separated),
 *   BACKLOG_RAG_PATH (default: .backlog), BACKLOG_RAG_MODEL
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Load .env file from mcp-server directory
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
import { createHash } from 'crypto';
import { Backlog } from 'backlog-js';
import type { Entity, Option } from 'backlog-js';
import { EmbeddingService } from './services/embeddingService.js';
import { VectorStore } from './services/vectorStore.js';
import { GraphStore } from './services/graphStore.js';
import { chunkByHeadings, chunkByParagraphs } from './utils/chunker.js';
import type { RAGConfig, RAGManifest, ChunkMetadata } from './types.js';
import type { Chunk } from './utils/chunker.js';

// ---- Types for intermediate JSON ----

interface FetchedIssue {
  itemId: string;
  issueKey: string;
  summary: string;
  description: string;
  contentHash: string;
  chunks: Chunk[];
  graphNode: {
    id: string;
    type: string;
    props: Record<string, unknown>;
  };
  edges: Array<{ source: string; target: string; type: string }>;
  extraNodes: Array<{ id: string; type: string; props: Record<string, unknown> }>;
}

interface FetchedDocument {
  itemId: string;
  nodeId: string;
  title: string;
  contentHash: string;
  chunks: Chunk[];
  url: string;
}

interface FetchedData {
  projectKey: string;
  fetchedAt: string;
  issues: FetchedIssue[];
  documents: FetchedDocument[];
  issueRemoteIds: string[];
  docRemoteIds: string[];
  skipped: { issues: number; documents: number };
}

interface EmbeddedData {
  projectKey: string;
  embeddedAt: string;
  items: Array<{
    itemId: string;
    type: 'issue' | 'document';
    project: string;
    title: string;
    sourceId: string;
    url: string;
    contentHash: string;
    chunks: Chunk[];
    vectors: number[][];
  }>;
  issueRemoteIds: string[];
  docRemoteIds: string[];
  skipped: { issues: number; documents: number };
  /** First chunk vector per issue for semantic edges */
  issueEmbeddings: Array<{ itemId: string; vector: number[] }>;
  /** Graph data passed through from fetch phase */
  graphData: {
    nodes: Record<string, { id: string; type: string; props: Record<string, unknown> }>;
    edges: Array<{ source: string; target: string; type: string }>;
  };
}

// ---- Config ----

function getConfig(): RAGConfig {
  const domain = process.env.BACKLOG_DOMAIN;
  const apiKey = process.env.BACKLOG_API_KEY;
  const projects = process.env.BACKLOG_PROJECTS?.split(',').map((s) => s.trim()) || [];
  const model = process.env.BACKLOG_RAG_MODEL || 'keitokei1994/ruri-v3-310m-onnx';
  const basePath = process.env.BACKLOG_RAG_PATH || '.backlog';

  if (!domain || !apiKey) {
    console.error('Error: BACKLOG_DOMAIN and BACKLOG_API_KEY environment variables are required');
    process.exit(1);
  }

  return { domain, apiKey, projects, model, basePath };
}

function computeHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadManifest(config: RAGConfig): RAGManifest {
  const manifestPath = path.join(config.basePath, 'manifest.json');
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  } catch {
    return { version: 1, model: config.model, indexed_at: '', items: {} };
  }
}

function saveManifest(config: RAGConfig, manifest: RAGManifest): void {
  const manifestPath = path.join(config.basePath, 'manifest.json');
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

function flattenDocTree(
  nodes: Entity.Document.DocumentTreeNode[]
): Entity.Document.DocumentTreeNode[] {
  const results: Entity.Document.DocumentTreeNode[] = [];
  for (const node of nodes) {
    results.push(node);
    if (node.children?.length) {
      results.push(...flattenDocTree(node.children));
    }
  }
  return results;
}

// ---- Phase 1: Fetch ----

async function cmdFetch(config: RAGConfig): Promise<void> {
  const manifest = loadManifest(config);
  let host = config.domain;
  if (host.startsWith('https://')) host = host.replace('https://', '');
  if (host.startsWith('http://')) host = host.replace('http://', '');
  host = host.split('/')[0];
  const backlog = new Backlog({ host, apiKey: config.apiKey });
  const projects = await backlog.getProjects();

  for (const projectKey of config.projects) {
    const project = projects.find(
      (p) => p.projectKey.toUpperCase() === projectKey.toUpperCase()
    );
    if (!project) {
      console.error(`Project ${projectKey} not found, skipping.`);
      continue;
    }

    console.error(`[fetch] Project: ${projectKey} (${project.name})`);

    const data: FetchedData = {
      projectKey,
      fetchedAt: new Date().toISOString(),
      issues: [],
      documents: [],
      issueRemoteIds: [],
      docRemoteIds: [],
      skipped: { issues: 0, documents: 0 },
    };

    // ---- Issues ----
    console.error(`[fetch] Fetching issues...`);
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
      console.error(`[fetch]   ${allIssues.length} issues fetched...`);
      if (issues.length < batchSize) break;
      await delay(200);
    }

    console.error(`[fetch] ${allIssues.length} issues total`);

    for (const issue of allIssues) {
      const itemId = `issue:${issue.issueKey}`;
      data.issueRemoteIds.push(itemId);

      const content = `${issue.summary}\n\n${issue.description || ''}`;
      const contentHash = computeHash(content);

      // Skip if unchanged
      if (manifest.items[itemId]?.content_hash === contentHash) {
        data.skipped.issues++;
        // Still need graph data even if content unchanged — build node/edges
      }

      const chunks = manifest.items[itemId]?.content_hash === contentHash
        ? [] // no chunks to embed
        : chunkByParagraphs(content, 500);

      // Build graph data
      const extraNodes: FetchedIssue['extraNodes'] = [];
      const edges: FetchedIssue['edges'] = [];

      if (issue.assignee) {
        const userId = `user:${issue.assignee.userId || issue.assignee.id}`;
        extraNodes.push({ id: userId, type: 'User', props: { name: issue.assignee.name, userId: issue.assignee.userId } });
        edges.push({ source: itemId, target: userId, type: 'assignedTo' });
      }
      if (issue.createdUser) {
        const userId = `user:${issue.createdUser.userId || issue.createdUser.id}`;
        extraNodes.push({ id: userId, type: 'User', props: { name: issue.createdUser.name, userId: issue.createdUser.userId } });
        edges.push({ source: itemId, target: userId, type: 'createdBy' });
      }
      if (issue.parentIssueId) {
        edges.push({ source: itemId, target: `issue:${projectKey}-${issue.parentIssueId}`, type: 'childOf' });
      }
      if (issue.milestone) {
        for (const ms of issue.milestone) {
          const msId = `milestone:${ms.id}`;
          extraNodes.push({ id: msId, type: 'Milestone', props: { name: ms.name, releaseDueDate: ms.releaseDueDate } });
          edges.push({ source: itemId, target: msId, type: 'milestoneOf' });
        }
      }
      if (issue.category) {
        for (const cat of issue.category) {
          const catId = `category:${cat.id}`;
          extraNodes.push({ id: catId, type: 'Category', props: { name: cat.name } });
          edges.push({ source: itemId, target: catId, type: 'categorizedAs' });
        }
      }
      if (issue.status) {
        const statusId = `status:${issue.status.id}`;
        extraNodes.push({ id: statusId, type: 'Status', props: { name: issue.status.name } });
        edges.push({ source: itemId, target: statusId, type: 'statusIs' });
      }
      if (issue.issueType) {
        const typeId = `issuetype:${issue.issueType.id}`;
        extraNodes.push({ id: typeId, type: 'IssueType', props: { name: issue.issueType.name } });
        edges.push({ source: itemId, target: typeId, type: 'typeIs' });
      }

      data.issues.push({
        itemId,
        issueKey: issue.issueKey,
        summary: issue.summary,
        description: issue.description || '',
        contentHash,
        chunks,
        graphNode: {
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
        },
        edges,
        extraNodes,
      });
    }

    // ---- Documents ----
    console.error(`[fetch] Fetching documents...`);
    try {
      const tree = await backlog.getDocumentTree(project.id);
      const nodes = flattenDocTree(tree.activeTree?.children || []);
      console.error(`[fetch] ${nodes.length} documents found`);

      for (const node of nodes) {
        const itemId = `doc:${node.id}`;
        data.docRemoteIds.push(itemId);

        let doc: Entity.Document.Document;
        try {
          doc = await backlog.getDocument(node.id);
        } catch {
          data.skipped.documents++;
          continue;
        }

        const content = doc.plain || '';
        if (!content.trim()) {
          data.skipped.documents++;
          continue;
        }

        const contentHash = computeHash(content);
        if (manifest.items[itemId]?.content_hash === contentHash) {
          data.skipped.documents++;
          continue;
        }

        const chunks = chunkByHeadings(content, 500);
        if (chunks.length === 0) {
          data.skipped.documents++;
          continue;
        }

        data.documents.push({
          itemId,
          nodeId: node.id,
          title: doc.title || node.name || node.id,
          contentHash,
          chunks,
          url: `https://${config.domain}/document/${projectKey}/${node.id}`,
        });

        await delay(100);
      }
    } catch (error) {
      console.error(`[fetch] Documents not available: ${error instanceof Error ? error.message : error}`);
    }

    // Save fetched data
    const outPath = path.join(config.basePath, `fetched-${projectKey}.json`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8');

    const needEmbed = data.issues.filter((i) => i.chunks.length > 0).length + data.documents.length;
    console.error(`[fetch] Done: ${data.issues.length} issues, ${data.documents.length} documents`);
    console.error(`[fetch] Need embedding: ${needEmbed} items`);
    console.error(`[fetch] Skipped (unchanged): ${data.skipped.issues} issues, ${data.skipped.documents} documents`);
    console.error(`[fetch] Output: ${outPath}`);
  }
}

// ---- Phase 2: Embed ----

async function cmdEmbed(config: RAGConfig): Promise<void> {
  const embedding = new EmbeddingService(config.model);
  console.error(`[embed] Loading model: ${config.model}...`);
  await embedding.ensureInitialized();
  console.error(`[embed] Model loaded`);

  for (const projectKey of config.projects) {
    const inPath = path.join(config.basePath, `fetched-${projectKey}.json`);
    if (!fs.existsSync(inPath)) {
      console.error(`[embed] ${inPath} not found. Run 'fetch' first.`);
      continue;
    }

    const data: FetchedData = JSON.parse(fs.readFileSync(inPath, 'utf-8'));
    console.error(`[embed] Project: ${projectKey}`);

    // Collect all texts to embed
    const allTexts: string[] = [];
    const chunkMap: Array<{ source: 'issue' | 'document'; sourceIdx: number; chunkIdx: number }> = [];

    // Issues with changed content
    for (let si = 0; si < data.issues.length; si++) {
      const issue = data.issues[si];
      if (issue.chunks.length === 0) continue; // unchanged
      for (let ci = 0; ci < issue.chunks.length; ci++) {
        allTexts.push(issue.chunks[ci].text);
        chunkMap.push({ source: 'issue', sourceIdx: si, chunkIdx: ci });
      }
    }

    // Documents
    for (let si = 0; si < data.documents.length; si++) {
      const doc = data.documents[si];
      for (let ci = 0; ci < doc.chunks.length; ci++) {
        allTexts.push(doc.chunks[ci].text);
        chunkMap.push({ source: 'document', sourceIdx: si, chunkIdx: ci });
      }
    }

    console.error(`[embed] ${allTexts.length} chunks to embed...`);

    const allVectors = allTexts.length > 0
      ? await embedding.embed(allTexts)
      : [];

    console.error(`[embed] ${allVectors.length} vectors generated`);

    // Build output
    const embedded: EmbeddedData = {
      projectKey,
      embeddedAt: new Date().toISOString(),
      items: [],
      issueRemoteIds: data.issueRemoteIds,
      docRemoteIds: data.docRemoteIds,
      skipped: data.skipped,
      issueEmbeddings: [],
      graphData: { nodes: {}, edges: [] },
    };

    // Build graph data
    for (const issue of data.issues) {
      embedded.graphData.nodes[issue.graphNode.id] = issue.graphNode as any;
      for (const node of issue.extraNodes) {
        embedded.graphData.nodes[node.id] = node as any;
      }
      for (const edge of issue.edges) {
        embedded.graphData.edges.push(edge);
      }
    }

    // Prepare per-item vectors
    const issueVectors = new Map<number, number[][]>();
    const docVectors = new Map<number, number[][]>();

    for (let vi = 0; vi < chunkMap.length; vi++) {
      const { source, sourceIdx, chunkIdx } = chunkMap[vi];
      const map = source === 'issue' ? issueVectors : docVectors;
      if (!map.has(sourceIdx)) map.set(sourceIdx, []);
      const arr = map.get(sourceIdx)!;
      arr[chunkIdx] = allVectors[vi];
    }

    // Issues
    for (let si = 0; si < data.issues.length; si++) {
      const issue = data.issues[si];
      if (issue.chunks.length === 0) continue;
      const vectors = issueVectors.get(si) || [];

      embedded.items.push({
        itemId: issue.itemId,
        type: 'issue',
        project: projectKey,
        title: issue.summary,
        sourceId: issue.issueKey,
        url: `https://${config.domain}/view/${issue.issueKey}`,
        contentHash: issue.contentHash,
        chunks: issue.chunks,
        vectors,
      });

      if (vectors.length > 0) {
        embedded.issueEmbeddings.push({ itemId: issue.itemId, vector: vectors[0] });
      }
    }

    // Documents
    for (let si = 0; si < data.documents.length; si++) {
      const doc = data.documents[si];
      const vectors = docVectors.get(si) || [];

      embedded.items.push({
        itemId: doc.itemId,
        type: 'document',
        project: projectKey,
        title: doc.title,
        sourceId: doc.nodeId,
        url: doc.url,
        contentHash: doc.contentHash,
        chunks: doc.chunks,
        vectors,
      });
    }

    const outPath = path.join(config.basePath, `embedded-${projectKey}.json`);
    fs.writeFileSync(outPath, JSON.stringify(embedded), 'utf-8'); // compact, can be large
    console.error(`[embed] Done: ${embedded.items.length} items`);
    console.error(`[embed] Output: ${outPath}`);
  }
}

// ---- Phase 3: Store ----

async function cmdStore(config: RAGConfig): Promise<void> {
  const vectorStore = new VectorStore(config.basePath);
  const graphStore = new GraphStore(config.basePath);
  const manifest = loadManifest(config);

  for (const projectKey of config.projects) {
    const inPath = path.join(config.basePath, `embedded-${projectKey}.json`);
    if (!fs.existsSync(inPath)) {
      console.error(`[store] ${inPath} not found. Run 'embed' first.`);
      continue;
    }

    const data: EmbeddedData = JSON.parse(fs.readFileSync(inPath, 'utf-8'));
    console.error(`[store] Project: ${projectKey}`);
    console.error(`[store] ${data.items.length} items to store`);

    // Build graph
    const graph = graphStore.createEmpty(projectKey);
    for (const [, node] of Object.entries(data.graphData.nodes)) {
      graphStore.addNode(graph, node as any);
    }
    for (const edge of data.graphData.edges) {
      graphStore.addEdge(graph, edge as any);
    }

    // Reset indexes for clean insert (much faster than upsert)
    console.error(`[store] Resetting vector indexes...`);
    await vectorStore.resetIndex('issues');
    await vectorStore.resetIndex('documents');

    // Insert vectors (no existence check needed after reset)
    let stored = 0;
    const total = data.items.length;
    for (const item of data.items) {
      const indexName = item.type === 'issue' ? 'issues' : 'documents';

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
        await vectorStore.insertItem(
          indexName,
          chunkId,
          item.vectors[ci],
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

      stored++;
      if (stored % 100 === 0) {
        console.error(`[store]   ${stored}/${total} stored...`);
      }
    }

    // Clean up stale manifest entries
    const issueRemoteIds = new Set(data.issueRemoteIds);
    const docRemoteIds = new Set(data.docRemoteIds);
    let deleted = 0;
    for (const [itemId, entry] of Object.entries(manifest.items)) {
      if (entry.project !== projectKey) continue;
      if (entry.type === 'issue' && !issueRemoteIds.has(itemId)) {
        delete manifest.items[itemId];
        deleted++;
      }
      if (entry.type === 'document' && !docRemoteIds.has(itemId)) {
        delete manifest.items[itemId];
        deleted++;
      }
    }

    // Semantic edges
    const issueEmbeddings = new Map<string, number[]>();
    for (const { itemId, vector } of data.issueEmbeddings) {
      issueEmbeddings.set(itemId, vector);
    }
    if (issueEmbeddings.size > 1) {
      console.error(`[store] Computing semantic edges for ${issueEmbeddings.size} issues...`);
      graphStore.addSemanticEdges(graph, issueEmbeddings, 0.7, 5);
    }

    graph.updatedAt = new Date().toISOString();
    graphStore.save(graph);

    manifest.indexed_at = new Date().toISOString();
    saveManifest(config, manifest);

    console.error(`[store] Done: ${stored} stored, ${deleted} deleted`);
    console.error(`[store] Skipped (unchanged): ${data.skipped.issues} issues, ${data.skipped.documents} documents`);
  }
}

// ---- Query: Issue context (graph only, no model) ----

interface IssueOpts {
  depth?: number;
  brief?: boolean;
  limit?: number;
}

function cmdIssue(config: RAGConfig, issueKey: string, opts: IssueOpts = {}): void {
  const graphStore = new GraphStore(config.basePath);
  const projectKey = issueKey.split('-')[0];
  const graph = graphStore.load(projectKey);
  if (!graph) {
    console.error(`No index found for project ${projectKey}. Run indexing first.`);
    process.exit(1);
  }

  const depth = opts.depth ?? 2;
  const limit = opts.limit ?? 10;
  const context = graphStore.getIssueContext(graph, `issue:${issueKey}`, depth);
  if (!context) {
    console.error(`Issue ${issueKey} not found in graph.`);
    process.exit(1);
  }

  if (opts.brief) {
    // Compact output: key fields only
    const pick = (n: any) => n ? { key: n.props?.key, summary: n.props?.summary, status: n.props?.status } : undefined;
    const brief = {
      issue: pick(context.issue),
      parent: pick(context.parent),
      children: context.children.slice(0, limit).map(pick),
      assignee: context.assignee ? { name: context.assignee.props?.name } : undefined,
      milestones: context.milestones.map((m: any) => m.props?.name),
      categories: context.categories.map((c: any) => c.props?.name),
      relatedIssues: context.relatedIssues.slice(0, limit).map(pick),
      semanticRelatedIssues: context.semanticRelatedIssues.slice(0, limit).map((n: any) => ({
        ...pick(n), similarity: n.similarity,
      })),
    };
    console.log(JSON.stringify(brief, null, 2));
  } else {
    // Full output with limits on arrays
    const limited = {
      ...context,
      relatedIssues: context.relatedIssues.slice(0, limit),
      semanticRelatedIssues: context.semanticRelatedIssues.slice(0, limit),
      children: context.children.slice(0, limit),
      _truncated: {
        relatedIssues: context.relatedIssues.length > limit ? `${context.relatedIssues.length} total, showing ${limit}` : undefined,
        semanticRelatedIssues: context.semanticRelatedIssues.length > limit ? `${context.semanticRelatedIssues.length} total, showing ${limit}` : undefined,
        children: context.children.length > limit ? `${context.children.length} total, showing ${limit}` : undefined,
      },
    };
    console.log(JSON.stringify(limited, null, 2));
  }
}

// ---- Query: Project overview (graph only, no model) ----

function cmdOverview(config: RAGConfig, projectKey: string): void {
  const graphStore = new GraphStore(config.basePath);
  const graph = graphStore.load(projectKey);
  if (!graph) {
    console.error(`No index found for project ${projectKey}. Run indexing first.`);
    process.exit(1);
  }

  const overview = graphStore.getProjectOverview(graph);
  console.log(JSON.stringify(overview, null, 2));
}

// ---- Query: Graph search (graph only, no model) ----

interface GraphSearchOpts {
  assignee?: string;
  status?: string;
  milestone?: string;
  keyword?: string;
  limit?: number;
}

function cmdGraphSearch(config: RAGConfig, projectKey: string, opts: GraphSearchOpts): void {
  const graphStore = new GraphStore(config.basePath);
  const graph = graphStore.load(projectKey);
  if (!graph) {
    console.error(`No index found for project ${projectKey}. Run indexing first.`);
    process.exit(1);
  }

  const issueNodes = Object.values(graph.nodes).filter((n) => n.type === 'Issue');
  const limit = opts.limit || 30;

  const results: Array<{
    key: string;
    summary: string;
    status?: string;
    assignee?: string;
    milestones?: string[];
    priority?: string;
    updated?: string;
  }> = [];

  for (const issue of issueNodes) {
    // Find connected nodes via edges
    const outEdges = graph.edges.filter((e) => e.source === issue.id);

    let assigneeName: string | undefined;
    let statusName: string | undefined;
    const milestoneNames: string[] = [];

    for (const edge of outEdges) {
      const target = graph.nodes[edge.target];
      if (!target) continue;
      if (edge.type === 'assignedTo') assigneeName = target.props.name as string;
      if (edge.type === 'statusIs') statusName = target.props.name as string;
      if (edge.type === 'milestoneOf') milestoneNames.push(target.props.name as string);
    }

    // Apply filters
    if (opts.assignee) {
      if (!assigneeName || !assigneeName.toLowerCase().includes(opts.assignee.toLowerCase())) continue;
    }
    if (opts.status) {
      if (!statusName || !statusName.toLowerCase().includes(opts.status.toLowerCase())) continue;
    }
    if (opts.milestone) {
      if (!milestoneNames.some((m) => m.toLowerCase().includes(opts.milestone!.toLowerCase()))) continue;
    }
    if (opts.keyword) {
      const summary = (issue.props.summary as string) || '';
      const key = (issue.props.key as string) || '';
      const kw = opts.keyword.toLowerCase();
      if (!summary.toLowerCase().includes(kw) && !key.toLowerCase().includes(kw)) continue;
    }

    results.push({
      key: (issue.props.key as string) || issue.id,
      summary: (issue.props.summary as string) || '',
      status: statusName,
      assignee: assigneeName,
      milestones: milestoneNames.length > 0 ? milestoneNames : undefined,
      priority: issue.props.priority as string | undefined,
      updated: issue.props.updated as string | undefined,
    });
  }

  // Sort by updated desc
  results.sort((a, b) => {
    const ta = a.updated ? new Date(a.updated).getTime() : 0;
    const tb = b.updated ? new Date(b.updated).getTime() : 0;
    return tb - ta;
  });

  const limited = results.slice(0, limit);
  console.log(JSON.stringify({ total: results.length, shown: limited.length, results: limited }, null, 2));
}

// ---- Query: Semantic search (needs model) ----

async function cmdSearch(config: RAGConfig, query: string, opts: { type?: string; project?: string; limit?: number }): Promise<void> {
  const embedding = new EmbeddingService(config.model);
  const vectorStore = new VectorStore(config.basePath);

  console.error(`[search] Loading model...`);
  await embedding.ensureInitialized();

  console.error(`[search] Searching: "${query}"`);
  const queryVector = await embedding.embedSingle(query);

  const types = opts.type && opts.type !== 'all' ? [opts.type] : undefined;
  const results = await vectorStore.search(queryVector, {
    types: types as string[] | undefined,
    project: opts.project,
    limit: opts.limit || 10,
  });

  console.log(JSON.stringify(results, null, 2));
}

// ---- Slack: Search messages (native fetch, no extra deps) ----

function getSlackToken(): string {
  const token = process.env.SLACK_TOKEN;
  if (!token) {
    console.error('Error: SLACK_TOKEN environment variable is required');
    console.error('Add SLACK_TOKEN=xoxp-... to mcp-server/.env');
    process.exit(1);
  }
  return token;
}

async function cmdSlackSearch(query: string, count: number = 20): Promise<void> {
  const token = getSlackToken();
  const params = new URLSearchParams({
    query,
    count: count.toString(),
    sort: 'timestamp',
    sort_dir: 'desc',
  });

  const resp = await fetch(`https://slack.com/api/search.messages?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await resp.json() as Record<string, unknown>;
  if (!data.ok) {
    console.error(`Slack API error: ${data.error}`);
    process.exit(1);
  }

  const messages = (data.messages as Record<string, unknown>)?.matches as Array<Record<string, unknown>> || [];
  const results = messages.map((m) => ({
    user: m.username || m.user,
    text: (m.text as string || '').substring(0, 300),
    channel: (m.channel as Record<string, unknown>)?.name || (m.channel as Record<string, unknown>)?.id,
    ts: m.ts,
    permalink: m.permalink,
  }));

  console.log(JSON.stringify({ query, total: results.length, results }, null, 2));
}

async function cmdSlackThread(channel: string, ts: string): Promise<void> {
  const token = getSlackToken();
  const params = new URLSearchParams({ channel, ts, limit: '50' });

  const resp = await fetch(`https://slack.com/api/conversations.replies?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await resp.json() as Record<string, unknown>;
  if (!data.ok) {
    console.error(`Slack API error: ${data.error}`);
    process.exit(1);
  }

  const messages = (data.messages as Array<Record<string, unknown>>) || [];
  const results = messages.map((m) => ({
    user: m.user,
    text: m.text,
    ts: m.ts,
  }));

  console.log(JSON.stringify({ channel, thread_ts: ts, messages: results }, null, 2));
}

// ---- Main ----

const command = process.argv[2];
const validCommands = ['fetch', 'embed', 'store', 'run', 'issue', 'overview', 'search', 'find', 'slack', 'slack-thread'];

if (!command || !validCommands.includes(command)) {
  console.error(`Usage: node dist/cli.js <command> [args]`);
  console.error(``);
  console.error(`  Indexing:`);
  console.error(`    fetch                Fetch data from Backlog API`);
  console.error(`    embed                Embed fetched data (requires fetch first)`);
  console.error(`    store                Store vectors and build graph (requires embed first)`);
  console.error(`    run                  Run all 3 phases sequentially`);
  console.error(``);
  console.error(`  Query:`);
  console.error(`    issue <KEY> [opts]   Issue context from graph (e.g. BNN-123)`);
  console.error(`      --brief              Compact output (key + summary only)`);
  console.error(`      --depth <n>          Graph traversal depth (default: 2)`);
  console.error(`      --limit <n>          Max related issues shown (default: 10)`);
  console.error(`    overview <PROJECT>   Project overview from graph (e.g. BNN)`);
  console.error(`    find <PROJECT> [opts] Graph search with filters (no model needed)`);
  console.error(`      --assignee <name>    Filter by assignee (partial match)`);
  console.error(`      --status <status>    Filter by status (partial match)`);
  console.error(`      --milestone <name>   Filter by milestone (partial match)`);
  console.error(`      --keyword <text>     Filter by summary keyword`);
  console.error(`      --limit <n>          Max results (default: 30)`);
  console.error(`    search <QUERY>       Semantic search (requires model load)`);
  console.error(``);
  console.error(`  Slack (requires SLACK_TOKEN in .env):`);
  console.error(`    slack <QUERY>        Search Slack messages`);
  console.error(`      --count <n>          Max results (default: 20)`);
  console.error(`    slack-thread <CH> <TS> Get thread replies`);
  process.exit(1);
}

const needsBacklogConfig = !['slack', 'slack-thread'].includes(command);
const config = needsBacklogConfig ? getConfig() : ({} as RAGConfig);

(async () => {
  try {
    if (command === 'fetch' || command === 'run') {
      await cmdFetch(config);
    }
    if (command === 'embed' || command === 'run') {
      await cmdEmbed(config);
    }
    if (command === 'store' || command === 'run') {
      await cmdStore(config);
    }
    if (command === 'issue') {
      const issueKey = process.argv[3];
      if (!issueKey) { console.error('Usage: issue <ISSUE_KEY> [--brief] [--depth N] [--limit N]'); process.exit(1); }
      const issueOpts: IssueOpts = {};
      const issueArgs = process.argv.slice(4);
      for (let i = 0; i < issueArgs.length; i++) {
        if (issueArgs[i] === '--brief') { issueOpts.brief = true; }
        else if (issueArgs[i] === '--depth' && issueArgs[i + 1]) { issueOpts.depth = parseInt(issueArgs[++i], 10); }
        else if (issueArgs[i] === '--limit' && issueArgs[i + 1]) { issueOpts.limit = parseInt(issueArgs[++i], 10); }
      }
      cmdIssue(config, issueKey, issueOpts);
    }
    if (command === 'overview') {
      const projectKey = process.argv[3];
      if (!projectKey) { console.error('Usage: overview <PROJECT_KEY>'); process.exit(1); }
      cmdOverview(config, projectKey);
    }
    if (command === 'find') {
      const projectKey = process.argv[3];
      if (!projectKey) { console.error('Usage: find <PROJECT> [--assignee X] [--status X] [--milestone X] [--keyword X] [--limit N]'); process.exit(1); }
      const findOpts: GraphSearchOpts = {};
      const args = process.argv.slice(4);
      for (let i = 0; i < args.length; i++) {
        if (args[i] === '--assignee' && args[i + 1]) { findOpts.assignee = args[++i]; }
        else if (args[i] === '--status' && args[i + 1]) { findOpts.status = args[++i]; }
        else if (args[i] === '--milestone' && args[i + 1]) { findOpts.milestone = args[++i]; }
        else if (args[i] === '--keyword' && args[i + 1]) { findOpts.keyword = args[++i]; }
        else if (args[i] === '--limit' && args[i + 1]) { findOpts.limit = parseInt(args[++i], 10); }
      }
      cmdGraphSearch(config, projectKey, findOpts);
    }
    if (command === 'search') {
      const query = process.argv.slice(3).join(' ');
      if (!query) { console.error('Usage: search <QUERY>'); process.exit(1); }
      await cmdSearch(config, query, {});
    }
    if (command === 'slack') {
      const query = process.argv.slice(3).filter(a => !a.startsWith('--')).join(' ');
      if (!query) { console.error('Usage: slack <QUERY> [--count N]'); process.exit(1); }
      const slackArgs = process.argv.slice(3);
      let count = 20;
      for (let i = 0; i < slackArgs.length; i++) {
        if (slackArgs[i] === '--count' && slackArgs[i + 1]) { count = parseInt(slackArgs[++i], 10); }
      }
      await cmdSlackSearch(query, count);
    }
    if (command === 'slack-thread') {
      const channel = process.argv[3];
      const ts = process.argv[4];
      if (!channel || !ts) { console.error('Usage: slack-thread <CHANNEL_ID> <THREAD_TS>'); process.exit(1); }
      await cmdSlackThread(channel, ts);
    }
    if (['fetch', 'embed', 'store', 'run'].includes(command)) {
      console.error(`\n[${command}] Complete!`);
    }
  } catch (error) {
    console.error(`Error:`, error);
    process.exit(1);
  }
})();
