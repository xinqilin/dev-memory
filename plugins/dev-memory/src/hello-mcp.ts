// Phase 0 spike: minimal stdio MCP server with one `hello` tool.
// Zero dependencies so the spike does not depend on node_modules being installed.
import { createInterface } from "node:readline";

type Message = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: any };

const SERVER_INFO = { name: "dev-memory", version: "0.0.1" };
const HELLO_TOOL = {
  name: "hello",
  description: "Phase 0 smoke test. Returns a greeting plus runtime evidence.",
  inputSchema: {
    type: "object",
    properties: { name: { type: "string", description: "Who to greet" } },
  },
};

function send(message: object) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function handle(message: Message) {
  const { id, method, params } = message;
  if (id === undefined) return; // notifications (e.g. notifications/initialized) need no reply

  switch (method) {
    case "initialize":
      return send({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      });
    case "ping":
      return send({ jsonrpc: "2.0", id, result: {} });
    case "tools/list":
      return send({ jsonrpc: "2.0", id, result: { tools: [HELLO_TOOL] } });
    case "tools/call": {
      if (params?.name !== HELLO_TOOL.name) {
        return send({ jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${params?.name}` } });
      }
      const who = params?.arguments?.name ?? "world";
      const host = process.env.PLUGIN_ROOT ? "codex" : process.env.CLAUDE_PLUGIN_ROOT ? "claude-code" : "unknown";
      const text = `DEV_MEMORY_MCP_OK hello ${who} (host=${host}, bun=${Bun.version}, cwd=${process.cwd()})`;
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: false } });
    }
    default:
      return send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  try {
    handle(JSON.parse(line));
  } catch (error) {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: String(error) } });
  }
}
