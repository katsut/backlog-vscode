#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { EmbeddingService } from './services/embeddingService.js';
import { VectorStore } from './services/vectorStore.js';
import { GraphStore } from './services/graphStore.js';
import { RAGIndexService } from './services/ragIndexService.js';
import type { RAGConfig } from './types.js';

function getConfig(): RAGConfig {
  const domain = process.env.BACKLOG_DOMAIN;
  const apiKey = process.env.BACKLOG_API_KEY;
  const projects = process.env.BACKLOG_PROJECTS?.split(',').map((s) => s.trim()) || [];
  const model = process.env.BACKLOG_RAG_MODEL || 'keitokei1994/ruri-v3-310m-onnx';
  const basePath = process.env.BACKLOG_RAG_PATH || '.backlog';

  if (!domain || !apiKey) {
    throw new Error(
      'BACKLOG_DOMAIN and BACKLOG_API_KEY environment variables are required'
    );
  }

  return { domain, apiKey, projects, model, basePath };
}

async function main() {
  const config = getConfig();

  const embeddingService = new EmbeddingService(config.model);
  const vectorStore = new VectorStore(config.basePath);
  const graphStore = new GraphStore(config.basePath);

  const indexService = new RAGIndexService(
    config,
    embeddingService,
    vectorStore,
    graphStore
  );

  const server = new McpServer({
    name: 'backlog-rag',
    version: '0.1.0',
  });

  // ---- Tool: backlog_search ----
  server.tool(
    'backlog_search',
    'Search Backlog documents, issues, and wiki pages using semantic similarity',
    {
      query: z.string().describe('Search query in natural language'),
      type: z
        .enum(['document', 'issue', 'wiki', 'all'])
        .default('all')
        .describe('Content type to search'),
      project: z.string().optional().describe('Filter by project key'),
      limit: z.number().default(10).describe('Maximum number of results'),
    },
    async ({ query, type, project, limit }) => {
      await embeddingService.ensureInitialized();
      const queryVector = await embeddingService.embedSingle(query);
      const results = await vectorStore.search(queryVector, {
        types: type === 'all' ? undefined : [type],
        project,
        limit,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }
  );

  // ---- Tool: backlog_issue_context ----
  server.tool(
    'backlog_issue_context',
    'Get comprehensive context for a Backlog issue using knowledge graph traversal',
    {
      issueKey: z.string().describe('Issue key (e.g., BNN-123)'),
      depth: z.number().default(2).describe('Graph traversal depth'),
      includeComments: z
        .boolean()
        .default(true)
        .describe('Include issue comments'),
    },
    async ({ issueKey, depth, includeComments }) => {
      const projectKey = issueKey.split('-')[0];
      const graph = graphStore.load(projectKey);
      if (!graph) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No index found for project ${projectKey}. Run indexing first.`,
            },
          ],
        };
      }

      const context = graphStore.getIssueContext(
        graph,
        `issue:${issueKey}`,
        depth
      );

      // Optionally enrich with comment text from vector store
      if (includeComments && context) {
        const commentChunks = await vectorStore.searchByMetadata('issues', {
          sourceId: issueKey,
          type: 'issue',
        });
        context.comments = commentChunks.map((c) => c.content);
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(context, null, 2),
          },
        ],
      };
    }
  );

  // ---- Tool: backlog_related_docs ----
  server.tool(
    'backlog_related_docs',
    'Find Backlog documents related to a query',
    {
      query: z.string().describe('Search query'),
      project: z.string().optional().describe('Filter by project key'),
      limit: z.number().default(5).describe('Maximum number of results'),
    },
    async ({ query, project, limit }) => {
      await embeddingService.ensureInitialized();
      const queryVector = await embeddingService.embedSingle(query);
      const results = await vectorStore.search(queryVector, {
        types: ['document'],
        project,
        limit,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    }
  );

  // ---- Tool: backlog_project_overview ----
  server.tool(
    'backlog_project_overview',
    'Get an overview of a Backlog project from the knowledge graph',
    {
      projectKey: z.string().describe('Project key (e.g., BNN)'),
    },
    async ({ projectKey }) => {
      const graph = graphStore.load(projectKey);
      if (!graph) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No index found for project ${projectKey}. Run indexing first.`,
            },
          ],
        };
      }

      const overview = graphStore.getProjectOverview(graph);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(overview, null, 2),
          },
        ],
      };
    }
  );

  // ---- Tool: backlog_index ----
  server.tool(
    'backlog_index',
    'Build or update the RAG index for specified Backlog projects',
    {
      projects: z
        .array(z.string())
        .optional()
        .describe('Project keys to index. Defaults to configured projects.'),
      rebuild: z
        .boolean()
        .default(false)
        .describe('Force full rebuild instead of incremental update'),
    },
    async ({ projects, rebuild }) => {
      const targetProjects = projects || config.projects;
      if (targetProjects.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'No projects specified. Set BACKLOG_PROJECTS env var or pass projects parameter.',
            },
          ],
        };
      }

      try {
        const results = await indexService.indexProjects(targetProjects, rebuild);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Indexing failed: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Start server
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
