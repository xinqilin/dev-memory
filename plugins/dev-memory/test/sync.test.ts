import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/core/db";
import { addRecord } from "../src/core/record";
import { search } from "../src/core/search";
import { sync } from "../src/core/sync";

const dirs: string[] = [];
function git(cwd: string, ...args: string[]) {
  const result = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

const RECORD = {
  id: "01JBSYNC0000000000000000001",
  author: "teammate",
  host: "codex",
  type: "decision",
  title: "改用 bigram 斷詞",
  body: "原因：unicode61 不斷中文\n決定：預先切成 bigram\n放棄：裝 extension",
  content_hash: "sha256:aaa",
  created_at: "2026-09-18T02:00:00.000Z",
  repos: ["example-org/example-repo"],
};

const PAGE = `---
type: decision
title: 改用 bigram 斷詞
product: billing
status: active
sources: ["01JBSYNC0000000000000000001"]
updated: 2026-09-18
---
中文的關鍵字搜尋要先切成 bigram，否則 unicode61 會把整句話當成一個詞。
`;

/** A remote memory repo plus a local clone, which is what a teammate actually has. */
async function repoPair(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "dev-memory-sync-"));
  dirs.push(root);
  const remote = join(root, "remote");
  mkdirSync(remote, { recursive: true });
  git(remote, "init", "-q", "-b", "main");

  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(remote, path, ".."), { recursive: true });
    await Bun.write(join(remote, path), content);
  }
  git(remote, "add", ".");
  git(remote, "commit", "-q", "-m", "memory");

  const clone = join(root, "clone");
  spawnSync("git", ["clone", "-q", remote, clone], { encoding: "utf8" });

  const db = openDb(join(root, "memory.db"));
  return { root, remote, clone, db, commit: (message: string) => git(remote, "commit", "-q", "-m", message) };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test("imports records and pages from origin/main and makes them searchable", async () => {
  const { clone, db } = await repoPair({
    "records/billing/2026-09/teammate.jsonl": JSON.stringify(RECORD) + "\n",
    "wiki/billing/decisions/bigram.md": PAGE,
  });

  const result = sync(db, clone, { fetch: false });
  expect(result.records).toMatchObject({ imported: 1, alreadyThere: 0 });
  expect(result.pages.imported).toBe(1);

  const row = db.query("select status, author from record where id = ?").get(RECORD.id) as { status: string; author: string };
  expect(row).toEqual({ status: "merged", author: "teammate" });

  const hits = search(db, "bigram 斷詞");
  expect(hits.some((hit) => hit.kind === "page" && hit.ref === "wiki/billing/decisions/bigram.md")).toBe(true);
  expect(hits.some((hit) => hit.kind === "record" && hit.ref === RECORD.id)).toBe(true);
  db.close();
});

test("syncing twice imports nothing new", async () => {
  const { clone, db } = await repoPair({ "records/billing/2026-09/teammate.jsonl": JSON.stringify(RECORD) + "\n" });

  sync(db, clone, { fetch: false });
  const second = sync(db, clone, { fetch: false });

  expect(second.records).toMatchObject({ imported: 0, alreadyThere: 1 });
  expect((db.query("select count(*) as n from fts where kind = 'record'").get() as { n: number }).n).toBe(1);
  db.close();
});

test("a record submitted from this machine flips to merged", async () => {
  const { clone, db } = await repoPair({ "records/billing/2026-09/teammate.jsonl": JSON.stringify(RECORD) + "\n" });

  const mine = addRecord(db, { type: "decision", title: RECORD.title, body: RECORD.body }, { cwd: "/" });
  db.run("update record set id = ? where id = ?", [RECORD.id, mine.id]);
  expect((db.query("select status from record where id = ?").get(RECORD.id) as { status: string }).status).toBe("local");

  const result = sync(db, clone, { fetch: false });
  expect(result.records.markedMerged).toBe(1);
  expect((db.query("select status from record where id = ?").get(RECORD.id) as { status: string }).status).toBe("merged");
  db.close();
});

test("a page deleted on main disappears from the index", async () => {
  const { remote, clone, db } = await repoPair({ "wiki/billing/decisions/bigram.md": PAGE });
  sync(db, clone, { fetch: false });
  expect((db.query("select count(*) as n from page").get() as { n: number }).n).toBe(1);

  rmSync(join(remote, "wiki", "billing", "decisions", "bigram.md"));
  git(remote, "add", "-A");
  git(remote, "commit", "-q", "-m", "drop page");
  spawnSync("git", ["-C", clone, "fetch", "-q", "origin"], { encoding: "utf8" });

  const result = sync(db, clone, { fetch: false });
  expect(result.pages.removed).toBe(1);
  expect((db.query("select count(*) as n from page").get() as { n: number }).n).toBe(0);
  expect(search(db, "bigram")).toEqual([]);
  db.close();
});

test("a superseded page is kept but never returned by search", async () => {
  const { clone, db } = await repoPair({
    "wiki/billing/decisions/old.md": PAGE.replace("status: active", "status: superseded\nsuperseded_by: bigram"),
  });

  sync(db, clone, { fetch: false });
  expect((db.query("select status from page").get() as { status: string }).status).toBe("superseded");
  expect(search(db, "bigram")).toEqual([]);
  db.close();
});

test("a malformed record line does not stop the sync", async () => {
  const { clone, db } = await repoPair({
    "records/billing/2026-09/teammate.jsonl": "{ broken\n" + JSON.stringify(RECORD) + "\n",
  });

  expect(sync(db, clone, { fetch: false }).records.imported).toBe(1);
  db.close();
});
