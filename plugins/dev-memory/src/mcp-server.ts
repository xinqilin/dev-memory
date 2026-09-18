#!/usr/bin/env bun
// stdio MCP server exposing the local index. Both tools load it from their own mcp config,
// and both get the same two tools. Bundled with `bun run build` so a git install needs no node_modules.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDb } from "./core/db";
import { repoIdFromDir } from "./core/repo-id";
import { type Kind, get, search } from "./core/search";

const KINDS = ["page", "record", "turn"] as const;

const server = new McpServer({ name: "dev-memory", version: "0.2.0" });

server.registerTool(
  "memory_search",
  {
    title: "Search development memory",
    description:
      "Search the team's development memory: wiki pages, saved records and raw conversation turns. " +
      "Works with Chinese and with code identifiers. Ask in the words you would use with a teammate, " +
      "and try a second wording if the first one returns nothing.",
    inputSchema: {
      query: z.string().describe("What to look for, in Chinese or English"),
      repo: z.string().optional().describe("owner/repo whose hits should rank first; defaults to the repo of cwd"),
      kind: z.enum(KINDS).array().optional().describe("Restrict to these kinds"),
      limit: z.number().int().min(1).max(50).optional(),
    },
  },
  async ({ query, repo, kind, limit }) => {
    const db = openDb();
    try {
      const hits = search(db, query, {
        limit,
        repoId: repo ?? repoIdFromDir(process.cwd()),
        kinds: kind as Kind[] | undefined,
      });
      if (hits.length === 0) {
        return { content: [{ type: "text", text: `No hits for "${query}". Try different words, or fewer of them.` }] };
      }
      const lines = hits.map(
        (hit) => `- [${hit.kind}] ${hit.ref}\n  ${hit.title}\n  ${hit.snippet.replace(/\s+/g, " ")}`,
      );
      return {
        content: [{ type: "text", text: `${hits.length} hits for "${query}":\n\n${lines.join("\n")}\n\nUse memory_get for the full text.` }],
      };
    } finally {
      db.close();
    }
  },
);

server.registerTool(
  "memory_get",
  {
    title: "Read one memory entry",
    description: "Return the full text behind a memory_search hit.",
    inputSchema: {
      kind: z.enum(KINDS),
      ref: z.string().describe("The ref from memory_search"),
    },
  },
  async ({ kind, ref }) => {
    const db = openDb();
    try {
      const body = get(db, kind, ref);
      return body === null
        ? { content: [{ type: "text", text: `Not found: ${kind} ${ref}` }], isError: true }
        : { content: [{ type: "text", text: body }] };
    } finally {
      db.close();
    }
  },
);

await server.connect(new StdioServerTransport());
