// The local review page: edit on the left, preview on the right, then approve and submit.
//
// Security, because this is an HTTP server on the author's machine:
// - bound to 127.0.0.1 only, on a random port
// - every request carries a one-time token, so another page in the browser cannot drive it
// - paths are resolved inside the worktree, so ../ cannot escape it
import type { Server } from "bun";
import { spawnSync } from "node:child_process";
import { watch } from "node:fs";
import { join, relative, resolve } from "node:path";
import { type Check, checkPage, hasErrors } from "./checks";
import { baseVersion, changedPages } from "../core/worktree";
import { openDb } from "../core/db";
import { get as getEntry } from "../core/search";

export interface ReviewOptions {
  worktree: string;
  branch: string;
  base?: string;
  port?: number;
  /** Where the built UI lives; overridden in tests. */
  uiDir?: string;
  onPublish?: (worktree: string, branch: string) => Promise<{ url?: string; message: string }>;
}

export interface ReviewServer {
  url: string;
  token: string;
  port: number;
  stop: () => void;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });

function git(cwd: string, args: string[]): { ok: boolean; out: string } {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: result.status === 0, out: (result.stdout + result.stderr).trim() };
}

export function contentHash(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 16);
}

export function startReviewServer(options: ReviewOptions): ReviewServer {
  const { worktree, branch } = options;
  const base = options.base ?? "origin/main";
  // The built UI: bundled marked/DOMPurify/diff, so the page works with no network.
  const uiDir = options.uiDir ?? join(import.meta.dir, "..", "..", "dist", "review-ui");
  const token = crypto.randomUUID();
  const listeners = new Set<(event: string) => void>();

  /** Refuses anything that resolves outside the worktree. */
  const safePath = (raw: string | null): string | null => {
    if (!raw) return null;
    const full = resolve(worktree, raw);
    const rel = relative(worktree, full);
    return rel && !rel.startsWith("..") ? full : null;
  };

  const authorized = (request: Request): boolean => {
    const url = new URL(request.url);
    return url.searchParams.get("token") === token || request.headers.get("authorization") === `Bearer ${token}`;
  };

  const watcher = watch(worktree, { recursive: true }, (_event, filename) => {
    if (!filename || filename.includes(".git/")) return;
    for (const listener of listeners) listener(String(filename));
  });

  const server: Server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    idleTimeout: 0,

    async fetch(request) {
      const url = new URL(request.url);
      if (!authorized(request)) return json({ error: "unauthorized" }, 401);

      // ---------- UI ----------
      if (url.pathname === "/") {
        return new Response(Bun.file(join(uiDir, "index.html")), { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (url.pathname === "/app.js" || url.pathname === "/style.css") {
        const file = Bun.file(join(uiDir, url.pathname.slice(1)));
        if (!(await file.exists())) return json({ error: "not found" }, 404);
        return new Response(file);
      }

      // ---------- API ----------
      if (url.pathname === "/api/pages") {
        const pages = changedPages(worktree, base).map((page) => {
          const file = Bun.file(join(worktree, page.path));
          return { ...page, exists: file.size > 0 };
        });
        return json({ branch, base, pages });
      }

      if (url.pathname === "/api/page") {
        const path = safePath(url.searchParams.get("path"));
        if (!path) return json({ error: "bad path" }, 400);
        const relPath = relative(worktree, path);

        if (request.method === "GET") {
          const file = Bun.file(path);
          const content = (await file.exists()) ? await file.text() : "";
          return json({
            path: relPath,
            content,
            hash: contentHash(content),
            base: baseVersion(worktree, relPath, base),
            checks: checkPage(relPath, content),
          });
        }

        if (request.method === "PUT") {
          const body = (await request.json()) as { content?: string; base_hash?: string };
          if (typeof body.content !== "string") return json({ error: "content is required" }, 400);

          const file = Bun.file(path);
          const current = (await file.exists()) ? await file.text() : "";
          if (body.base_hash && body.base_hash !== contentHash(current)) {
            // Someone else — the agent, an editor — changed the file since this tab loaded it.
            return json({ error: "conflict", current, hash: contentHash(current) }, 409);
          }

          await Bun.write(path, body.content);
          const checks = checkPage(relPath, body.content);
          return json({ hash: contentHash(body.content), checks });
        }
      }

      if (url.pathname === "/api/discard" && request.method === "POST") {
        const path = safePath(url.searchParams.get("path"));
        if (!path) return json({ error: "bad path" }, 400);
        const relPath = relative(worktree, path);
        const original = baseVersion(worktree, relPath, base);

        if (original === null) {
          await Bun.file(path).delete();
          return json({ removed: true });
        }
        await Bun.write(path, original);
        return json({ removed: false, content: original, hash: contentHash(original) });
      }

      if (url.pathname === "/api/approve" && request.method === "POST") {
        const pages = changedPages(worktree, base);
        const failing: { path: string; checks: Check[] }[] = [];

        for (const page of pages) {
          if (page.status === "deleted") continue;
          const content = await Bun.file(join(worktree, page.path)).text();
          const checks = checkPage(page.path, content);
          if (hasErrors(checks)) failing.push({ path: page.path, checks });
        }
        if (failing.length > 0) return json({ error: "checks failed", failing }, 422);

        const add = git(worktree, ["add", "-A"]);
        if (!add.ok) return json({ error: add.out }, 500);
        const commit = git(worktree, ["commit", "-m", `memory: ${branch.split("/").at(-1)}`]);
        if (!commit.ok && !commit.out.includes("nothing to commit")) return json({ error: commit.out }, 500);
        return json({ committed: true, message: commit.out });
      }

      // Publishing pushes to GitHub. Only the person clicking the button may trigger it;
      // the skills tell the agent never to call this endpoint.
      if (url.pathname === "/api/publish" && request.method === "POST") {
        if (!options.onPublish) return json({ error: "publishing is not configured" }, 501);
        try {
          const result = await options.onPublish(worktree, branch);
          return json(result);
        } catch (error) {
          return json({ error: String(error) }, 500);
        }
      }

      // The "來源紀錄" tab: the records a page says it came from, read from the local index.
      if (url.pathname === "/api/source") {
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "id is required" }, 400);
        const db = openDb();
        try {
          const body = getEntry(db, "record", id);
          if (body === null) return json({ error: "not found", id }, 404);
          const row = db.query("select title, author, created_at from record where id = ?").get(id) as
            | { title: string; author: string; created_at: string }
            | null;
          return json({ id, body, ...(row ?? {}) });
        } finally {
          db.close();
        }
      }

      if (url.pathname === "/api/events") {
        const stream = new ReadableStream({
          start(controller) {
            const send = (data: string) => controller.enqueue(`data: ${data}\n\n`);
            send("ready");
            const listener = (filename: string) => send(filename);
            listeners.add(listener);
            request.signal.addEventListener("abort", () => {
              listeners.delete(listener);
              controller.close();
            });
          },
        });
        return new Response(stream, {
          headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" },
        });
      }

      return json({ error: "not found" }, 404);
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}/?token=${token}`,
    token,
    port: server.port,
    stop: () => {
      watcher.close();
      server.stop(true);
    },
  };
}
