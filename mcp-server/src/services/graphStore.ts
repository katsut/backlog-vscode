import * as fs from 'fs';
import * as path from 'path';
import type {
  KnowledgeGraph,
  GraphNode,
  GraphEdge,
  IssueContextResult,
  ProjectOverview,
} from '../types.js';

export class GraphStore {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  private getGraphPath(projectKey: string): string {
    return path.join(this.basePath, 'graph', `${projectKey}.json`);
  }

  load(projectKey: string): KnowledgeGraph | null {
    const graphPath = this.getGraphPath(projectKey);
    try {
      const content = fs.readFileSync(graphPath, 'utf-8');
      return JSON.parse(content) as KnowledgeGraph;
    } catch {
      return null;
    }
  }

  save(graph: KnowledgeGraph): void {
    const graphPath = this.getGraphPath(graph.projectKey);
    const dir = path.dirname(graphPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2), 'utf-8');
  }

  createEmpty(projectKey: string): KnowledgeGraph {
    return {
      projectKey,
      updatedAt: new Date().toISOString(),
      nodes: {},
      edges: [],
    };
  }

  addNode(graph: KnowledgeGraph, node: GraphNode): void {
    graph.nodes[node.id] = node;
  }

  addEdge(graph: KnowledgeGraph, edge: GraphEdge): void {
    // Avoid duplicate edges
    const exists = graph.edges.some(
      (e) =>
        e.source === edge.source &&
        e.target === edge.target &&
        e.type === edge.type
    );
    if (!exists) {
      graph.edges.push(edge);
    }
  }

  /**
   * Add semantic relationship edges between issues based on embedding similarity.
   * Uses sampling to avoid O(n²) full comparison.
   * For each issue, compare against a random sample of candidates.
   */
  addSemanticEdges(
    graph: KnowledgeGraph,
    issueEmbeddings: Map<string, number[]>,
    similarityThreshold: number = 0.7,
    maxEdgesPerIssue: number = 5
  ): void {
    // Remove old semantic edges
    graph.edges = graph.edges.filter(
      (e) => e.type !== 'semanticallyRelatedTo'
    );

    const issueIds = Array.from(issueEmbeddings.keys());
    const n = issueIds.length;
    if (n < 2) return;

    // Sample size per issue: compare against sqrt(n)*2 random candidates (capped at n-1)
    const sampleSize = Math.min(n - 1, Math.max(50, Math.ceil(Math.sqrt(n) * 2)));

    for (let i = 0; i < n; i++) {
      const sourceId = issueIds[i];
      const sourceVec = issueEmbeddings.get(sourceId)!;
      const similarities: Array<{ targetId: string; score: number }> = [];

      // Build sample indices (Fisher-Yates partial shuffle)
      const candidates: number[] = [];
      const pool = Array.from({ length: n }, (_, idx) => idx);
      // Remove self
      pool.splice(i, 1);
      const actualSample = Math.min(sampleSize, pool.length);
      for (let s = 0; s < actualSample; s++) {
        const r = s + Math.floor(Math.random() * (pool.length - s));
        [pool[s], pool[r]] = [pool[r], pool[s]];
        candidates.push(pool[s]);
      }

      for (const j of candidates) {
        const targetId = issueIds[j < i ? j : j]; // index already adjusted
        const targetVec = issueEmbeddings.get(targetId)!;
        const score = this.cosineSimilarity(sourceVec, targetVec);

        if (score >= similarityThreshold) {
          similarities.push({ targetId, score });
        }
      }

      // Sort by score desc, take top N
      similarities.sort((a, b) => b.score - a.score);
      const topSimilar = similarities.slice(0, maxEdgesPerIssue);

      for (const { targetId, score } of topSimilar) {
        graph.edges.push({
          source: sourceId,
          target: targetId,
          type: 'semanticallyRelatedTo',
          weight: Math.round(score * 1000) / 1000,
        });
      }
    }
  }

  /**
   * BFS traversal from a start node
   */
  bfsTraverse(
    graph: KnowledgeGraph,
    startId: string,
    maxDepth: number = 2
  ): Set<string> {
    const visited = new Set<string>();
    const queue: Array<[string, number]> = [[startId, 0]];

    while (queue.length > 0) {
      const [nodeId, depth] = queue.shift()!;
      if (visited.has(nodeId) || depth > maxDepth) continue;
      visited.add(nodeId);

      // Find neighbors (both directions)
      for (const edge of graph.edges) {
        if (edge.source === nodeId && !visited.has(edge.target)) {
          queue.push([edge.target, depth + 1]);
        }
        if (edge.target === nodeId && !visited.has(edge.source)) {
          queue.push([edge.source, depth + 1]);
        }
      }
    }

    return visited;
  }

  /**
   * Get comprehensive context for an issue
   */
  getIssueContext(
    graph: KnowledgeGraph,
    issueNodeId: string,
    depth: number = 2
  ): IssueContextResult | null {
    const issue = graph.nodes[issueNodeId];
    if (!issue) return null;

    const outEdges = graph.edges.filter((e) => e.source === issueNodeId);
    const inEdges = graph.edges.filter((e) => e.target === issueNodeId);

    let parent: GraphNode | undefined;
    const children: GraphNode[] = [];
    let assignee: GraphNode | undefined;
    const milestones: GraphNode[] = [];
    const categories: GraphNode[] = [];
    const relatedIssues: GraphNode[] = [];
    const semanticRelatedIssues: Array<GraphNode & { similarity: number }> = [];

    for (const edge of outEdges) {
      const target = graph.nodes[edge.target];
      if (!target) continue;

      switch (edge.type) {
        case 'childOf':
          parent = target;
          break;
        case 'assignedTo':
          assignee = target;
          break;
        case 'milestoneOf':
          milestones.push(target);
          break;
        case 'categorizedAs':
          categories.push(target);
          break;
        case 'semanticallyRelatedTo':
          semanticRelatedIssues.push({
            ...target,
            similarity: edge.weight || 0,
          });
          break;
      }
    }

    // Find children (edges where target is this issue with childOf type)
    for (const edge of inEdges) {
      const source = graph.nodes[edge.source];
      if (!source) continue;
      if (edge.type === 'childOf') {
        children.push(source);
      }
    }

    // BFS for structurally related issues
    if (depth > 1) {
      const reachable = this.bfsTraverse(graph, issueNodeId, depth);
      for (const nodeId of reachable) {
        const node = graph.nodes[nodeId];
        if (
          node &&
          node.type === 'Issue' &&
          node.id !== issueNodeId &&
          !children.some((c) => c.id === nodeId) &&
          parent?.id !== nodeId
        ) {
          relatedIssues.push(node);
        }
      }
    }

    // Sort semantic related by similarity desc
    semanticRelatedIssues.sort((a, b) => b.similarity - a.similarity);

    return {
      issue,
      parent,
      children,
      assignee,
      milestones,
      categories,
      relatedIssues,
      semanticRelatedIssues,
    };
  }

  /**
   * Get project overview from graph
   */
  getProjectOverview(graph: KnowledgeGraph): ProjectOverview {
    const issueNodes = Object.values(graph.nodes).filter(
      (n) => n.type === 'Issue'
    );
    const statusBreakdown: Record<string, number> = {};
    const assigneeCounts: Record<string, number> = {};

    for (const issue of issueNodes) {
      const statusEdge = graph.edges.find(
        (e) => e.source === issue.id && e.type === 'statusIs'
      );
      if (statusEdge) {
        const status = graph.nodes[statusEdge.target];
        const statusName = (status?.props?.name as string) || 'Unknown';
        statusBreakdown[statusName] = (statusBreakdown[statusName] || 0) + 1;
      }

      const assigneeEdge = graph.edges.find(
        (e) => e.source === issue.id && e.type === 'assignedTo'
      );
      if (assigneeEdge) {
        const user = graph.nodes[assigneeEdge.target];
        const userName = (user?.props?.name as string) || 'Unknown';
        assigneeCounts[userName] = (assigneeCounts[userName] || 0) + 1;
      }
    }

    const recentIssues = issueNodes
      .filter((i) => i.props.updated)
      .sort(
        (a, b) =>
          new Date(b.props.updated as string).getTime() -
          new Date(a.props.updated as string).getTime()
      )
      .slice(0, 10)
      .map((i) => ({
        key: (i.props.key as string) || i.id,
        summary: (i.props.summary as string) || '',
        status: (i.props.status as string) || '',
        updated: (i.props.updated as string) || '',
      }));

    const milestoneNodes = Object.values(graph.nodes).filter(
      (n) => n.type === 'Milestone'
    );
    const categoryNodes = Object.values(graph.nodes).filter(
      (n) => n.type === 'Category'
    );

    const topAssignees = Object.entries(assigneeCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      projectKey: graph.projectKey,
      issueCount: issueNodes.length,
      statusBreakdown,
      recentIssues,
      milestones: milestoneNodes.map((m) => ({
        name: (m.props.name as string) || '',
        dueDate: m.props.releaseDueDate as string | undefined,
      })),
      categories: categoryNodes.map((c) => (c.props.name as string) || ''),
      topAssignees,
    };
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
