import { expect, test } from "bun:test";
import { join } from "node:path";

const SERVER = join(import.meta.dir, "..", "src", "hello-mcp.ts");

async function exchange(messages: object[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", SERVER], {
    stdin: "pipe",
    stdout: "pipe",
    env: { ...process.env, ...env },
  });
  for (const m of messages) proc.stdin.write(JSON.stringify(m) + "\n");
  proc.stdin.end();
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.trim().split("\n").map((l) => JSON.parse(l));
}

test("stdio MCP handshake, tools/list and tools/call", async () => {
  const replies = await exchange(
    [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "hello", arguments: { name: "bill" } } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } },
    ],
    { PLUGIN_ROOT: "/tmp/fake-root" },
  );

  expect(replies).toHaveLength(4); // the notification gets no reply
  expect(replies[0].result.protocolVersion).toBe("2025-11-25");
  expect(replies[0].result.capabilities).toEqual({ tools: {} });
  expect(replies[1].result.tools.map((t: any) => t.name)).toEqual(["hello"]);
  expect(replies[2].result.content[0].text).toStartWith("DEV_MEMORY_MCP_OK hello bill (host=codex");
  expect(replies[3].error.code).toBe(-32602);
});
