// ---- RAG Manifest ----

export interface RAGManifestItem {
  type: 'document' | 'issue' | 'wiki';
  project: string;
  content_hash: string;
  indexed_at: string;
  chunk_count: number;
}

export interface RAGManifest {
  version: number;
  model: string;
  indexed_at: string;
  items: Record<string, RAGManifestItem>;
}

// ---- Knowledge Graph ----

export interface GraphNode {
  id: string;
  type: 'Issue' | 'User' | 'Milestone' | 'Category' | 'Status' | 'IssueType';
  props: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  type:
    | 'assignedTo'
    | 'childOf'
    | 'milestoneOf'
    | 'categorizedAs'
    | 'statusIs'
    | 'typeIs'
    | 'createdBy'
    | 'updatedBy'
    | 'semanticallyRelatedTo';
  /** Cosine similarity score (for semanticallyRelatedTo edges) */
  weight?: number;
}

export interface KnowledgeGraph {
  projectKey: string;
  updatedAt: string;
  nodes: Record<string, GraphNode>;
  edges: GraphEdge[];
}

// ---- Vector Chunks ----

export interface ChunkMetadata {
  id: string;
  type: 'document' | 'issue' | 'wiki';
  project: string;
  title: string;
  sourceId: string;
  chunkIndex: number;
  url?: string;
  [key: string]: unknown;
}

// ---- Search Results ----

export interface SearchResult {
  content: string;
  metadata: ChunkMetadata;
  score: number;
}

export interface IssueContextResult {
  issue: GraphNode;
  parent?: GraphNode;
  children: GraphNode[];
  assignee?: GraphNode;
  milestones: GraphNode[];
  categories: GraphNode[];
  /** Structurally related issues (parent/child/sibling) */
  relatedIssues: GraphNode[];
  /** Semantically similar issues (by embedding cosine similarity) */
  semanticRelatedIssues: Array<GraphNode & { similarity: number }>;
  comments?: string[];
}

export interface ProjectOverview {
  projectKey: string;
  issueCount: number;
  statusBreakdown: Record<string, number>;
  recentIssues: Array<{ key: string; summary: string; status: string; updated: string }>;
  milestones: Array<{ name: string; dueDate?: string }>;
  categories: string[];
  topAssignees: Array<{ name: string; count: number }>;
}

// ---- Config ----

export interface RAGConfig {
  domain: string;
  apiKey: string;
  projects: string[];
  model: string;
  basePath: string;
}
