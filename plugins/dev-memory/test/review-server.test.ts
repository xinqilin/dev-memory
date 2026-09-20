import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contentHash, startReviewServer, type ReviewServer } from "../src/review/server";
import { ensureWorktree } from "../src/core/worktree";

const dirs: string[] = [];
const servers: ReviewServer[] = [];

function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

const PAGE = `---
type: decision
title: 匯出報表改成單筆失敗不中斷
status: active
sources: ["01JBREVIEW000000000000001"]
updated: 2026-09-18
---
原因：整批 rollback 會讓已完成的匯出重跑
`;

async function scenario() {
  const root = mkdtempSync(join(tmpdir(), "dev-memory-review-"));
  dirs.push(root);

  const remote = join(root, "remote");
  mkdirSync(remote, { recursive: true });
  git(remote, "init", "-q", "-b", "main");
  await Bun.write(join(remote, "wiki", "index.md"), "# 目錄\n");
  await Bun.write(join(remote, "wiki", "existing.md"), PAGE);
  git(remote, "add", ".");
  git(remote, "commit", "-q", "-m", "init");

  const clone = join(root, "clone");
  spawnSync("git", ["clone", "-q", remote, clone], { encoding: "utf8" });

  const { path: worktree } = ensureWorktree(clone, "mem/t/20260918-review", { fetch: false });
  await Bun.write(join(worktree, "wiki", "new.md"), PAGE.replace("匯出報表改成單筆失敗不中斷", "新的一頁"));

  const server = startReviewServer({ worktree, branch: "mem/t/20260918-review", onPublish: async () => ({ message: "pushed", url: "https://example.test/pr/1" }) });
  servers.push(server);

  const api = (path: string, init?: RequestInit) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, {
      ...init,
      headers: { ...(init?.headers ?? {}), authorization: `Bearer ${server.token}` },
    });

  return { root, clone, worktree, server, api };
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("every endpoint needs the token", async () => {
  const { server } = await scenario();
  const anonymous = await fetch(`http://127.0.0.1:${server.port}/api/pages`);
  expect(anonymous.status).toBe(401);

  const withQueryToken = await fetch(`http://127.0.0.1:${server.port}/api/pages?token=${server.token}`);
  expect(withQueryToken.status).toBe(200);
});

test("lists what this ingest changed", async () => {
  const { api } = await scenario();
  const body = (await (await api("/api/pages")).json()) as any;

  expect(body.branch).toBe("mem/t/20260918-review");
  expect(body.pages).toEqual([{ path: "wiki/new.md", status: "added", exists: true }]);
});

test("reads a page with its base version and its checks", async () => {
  const { api } = await scenario();
  const created = (await (await api("/api/page?path=wiki/new.md")).json()) as any;
  expect(created.content).toContain("新的一頁");
  expect(created.base).toBeNull(); // new page: nothing to compare with
  expect(created.checks).toEqual([]);

  const existing = (await (await api("/api/page?path=wiki/existing.md")).json()) as any;
  expect(existing.base).toContain("匯出報表改成單筆失敗不中斷");
});

test("saves with base_hash and refuses to clobber an outside edit", async () => {
  const { api, worktree } = await scenario();
  const page = (await (await api("/api/page?path=wiki/new.md")).json()) as any;

  const ok = await api("/api/page?path=wiki/new.md", {
    method: "PUT",
    body: JSON.stringify({ content: page.content + "\n作者補的一句\n", base_hash: page.hash }),
  });
  expect(ok.status).toBe(200);
  expect(await Bun.file(join(worktree, "wiki", "new.md")).text()).toContain("作者補的一句");

  // The agent edits the same file behind the page's back.
  await Bun.write(join(worktree, "wiki", "new.md"), PAGE + "\nAI 改的\n");
  const conflict = await api("/api/page?path=wiki/new.md", {
    method: "PUT",
    body: JSON.stringify({ content: "我的版本", base_hash: page.hash }),
  });
  expect(conflict.status).toBe(409);
  expect(((await conflict.json()) as any).current).toContain("AI 改的");
});

// A page once lost its whole content this way: a stale conflict dialog sent base_hash: undefined,
// the check was skipped because undefined is falsy, and the file was overwritten with "undefined".
test("a write with no base_hash is refused, not silently accepted", async () => {
  const { api, worktree } = await scenario();
  const before = await Bun.file(join(worktree, "wiki", "new.md")).text();

  for (const payload of [{ content: "undefined" }, { content: "undefined", base_hash: null }]) {
    const refused = await api("/api/page?path=wiki/new.md", { method: "PUT", body: JSON.stringify(payload) });
    expect(refused.status).toBe(400);
  }

  expect(await Bun.file(join(worktree, "wiki", "new.md")).text()).toBe(before);
});

test("refuses to touch anything outside the worktree", async () => {
  const { api } = await scenario();
  const escaped = await api("/api/page?path=../../../etc/hosts");
  expect(escaped.status).toBe(400);
});

test("discard removes a new page and restores an edited one", async () => {
  const { api, worktree } = await scenario();
  await Bun.write(join(worktree, "wiki", "existing.md"), PAGE + "\n改壞了\n");

  const restored = (await (await api("/api/discard?path=wiki/existing.md", { method: "POST" })).json()) as any;
  expect(restored.removed).toBe(false);
  expect(await Bun.file(join(worktree, "wiki", "existing.md")).text()).toBe(PAGE);

  const removed = (await (await api("/api/discard?path=wiki/new.md", { method: "POST" })).json()) as any;
  expect(removed.removed).toBe(true);
  expect(existsSync(join(worktree, "wiki", "new.md"))).toBe(false);
});

test("approve refuses while a check fails, and commits once it passes", async () => {
  const { api, worktree } = await scenario();
  await Bun.write(join(worktree, "wiki", "new.md"), PAGE.replace("updated: 2026-09-18", "updated: 2026-09-18\n") + "\nAKIA1234567890ABCDEF\n");

  const rejected = await api("/api/approve", { method: "POST" });
  expect(rejected.status).toBe(422);
  const body = (await rejected.json()) as any;
  expect(body.failing[0].checks.some((c: any) => c.message.includes("疑似機密"))).toBe(true);

  await Bun.write(join(worktree, "wiki", "new.md"), PAGE);
  const approved = await api("/api/approve", { method: "POST" });
  expect(approved.status).toBe(200);
  expect(git(worktree, "log", "--oneline", "-1")).toContain("memory: 20260918-review");
  expect(git(worktree, "status", "--porcelain")).toBe("");
});

test("publish is only reachable through the endpoint the button calls", async () => {
  const { api } = await scenario();
  const result = (await (await api("/api/publish", { method: "POST" })).json()) as any;
  expect(result).toEqual({ message: "pushed", url: "https://example.test/pr/1" });
});

test("an outside edit is announced over SSE", async () => {
  const { api, worktree } = await scenario();
  const response = await api("/api/events");
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  expect(decoder.decode((await reader.read()).value)).toContain("ready");

  await Bun.write(join(worktree, "wiki", "new.md"), PAGE + "\n外面改的\n");
  const event = decoder.decode((await reader.read()).value);
  expect(event).toContain("wiki/new.md");
  await reader.cancel();
});

test("contentHash is stable and changes with the content", () => {
  expect(contentHash("abc")).toBe(contentHash("abc"));
  expect(contentHash("abc")).not.toBe(contentHash("abd"));
});

test("the page's stylesheet and script load, because the first load sets a cookie", async () => {
  const { server } = await scenario();
  const page = await fetch(`http://127.0.0.1:${server.port}/?token=${server.token}`);
  expect(page.status).toBe(200);

  const cookie = page.headers.get("set-cookie") ?? "";
  expect(cookie).toContain(`dev_memory_token=${server.token}`);
  expect(cookie).toContain("SameSite=Strict"); // another site cannot drive this server

  // A <link> or <script> request carries the cookie but no header and no query token.
  const withCookie = (path: string) =>
    fetch(`http://127.0.0.1:${server.port}${path}`, { headers: { cookie: `dev_memory_token=${server.token}` } });

  expect((await withCookie("/style.css")).status).toBe(200);
  expect((await withCookie("/app.js")).status).toBe(200);
  expect((await withCookie("/api/pages")).status).toBe(200);

  const wrongCookie = await fetch(`http://127.0.0.1:${server.port}/style.css`, { headers: { cookie: "dev_memory_token=nope" } });
  expect(wrongCookie.status).toBe(401);
});

test("the page list says whether anything is waiting to be committed", async () => {
  const { api, worktree } = await scenario();
  const before = (await (await api("/api/pages")).json()) as any;
  expect(before.dirty).toBe(true); // wiki/new.md is written but not committed
  expect(before.ahead).toBe(0); // so there is nothing to publish yet

  await api("/api/approve", { method: "POST" });

  const after = (await (await api("/api/pages")).json()) as any;
  expect(after.dirty).toBe(false);
  expect(after.ahead).toBe(1); // now the publish button is the one to press
  void worktree;
});

test("records files and repos.yaml are not judged by wiki page rules", async () => {
  const { api, worktree } = await scenario();
  await Bun.write(join(worktree, "repos.yaml"), "products:\n  billing:\n    repos: []\n");
  await Bun.write(
    join(worktree, "records", "billing", "2026-09", "bill.lin.jsonl"),
    JSON.stringify({
      id: "01JBREVIEW000000000000001",
      author: "bill.lin",
      host: "claude-code",
      type: "decision",
      title: "t",
      body: "b",
      content_hash: "sha256:x",
      created_at: "2026-09-18T00:00:00.000Z",
    }) + "\n",
  );

  const approved = await api("/api/approve", { method: "POST" });
  expect(approved.status).toBe(200); // a JSONL file has no frontmatter, and that is fine
  expect(git(worktree, "status", "--porcelain")).toBe("");
});

test("a broken records line blocks approval", async () => {
  const { api, worktree } = await scenario();
  await Bun.write(join(worktree, "records", "billing", "2026-09", "bill.lin.jsonl"), "{ not json\n");

  const rejected = await api("/api/approve", { method: "POST" });
  expect(rejected.status).toBe(422);
  const body = (await rejected.json()) as any;
  expect(body.failing.some((f: any) => f.checks.some((c: any) => c.message.includes("不是合法 JSON")))).toBe(true);
});
