// Records are the unit that gets committed to the memory repo. Locally they are just rows;
// `status` tracks how far they have travelled: local -> submitted -> merged.
import type { Database } from "bun:sqlite";
import { spawnSync } from "node:child_process";
import type { Host } from "../adapters/types";
import { repoIdFromDir } from "./repo-id";
import { tokenizeForIndex } from "./tokenize";

export interface RecordInput {
  type: string; // decision | feature | runbook | ...
  title: string;
  body: string;
  product?: string | null;
  repos?: string[];
  branch?: string | null;
  entities?: unknown[];
  files?: unknown[];
  commits?: unknown[];
  supersedes?: string | null;
}

export interface StoredRecord extends Required<Omit<RecordInput, "product" | "branch" | "supersedes">> {
  id: string;
  author: string;
  host: Host;
  product: string | null;
  branch: string | null;
  supersedes: string | null;
  contentHash: string;
  createdAt: string;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID: sortable by time, unique enough across machines, and safe in a filename. */
export function ulid(now = Date.now()): string {
  let time = "";
  for (let i = 9; i >= 0; i--) {
    time = CROCKFORD[(now / 32 ** (9 - i)) % 32 | 0] + time;
  }
  const random = crypto.getRandomValues(new Uint8Array(16));
  return time + Array.from(random.slice(0, 16), (byte) => CROCKFORD[byte % 32]).join("");
}

export function contentHash(input: RecordInput): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(`${input.type}\n${input.title}\n${input.body}`);
  return `sha256:${hasher.digest("hex")}`;
}

export function gitAuthor(cwd: string): string {
  const result = spawnSync("git", ["-C", cwd, "config", "user.name"], { encoding: "utf8" });
  const name = result.status === 0 ? result.stdout.trim() : "";
  return name || process.env.USER || "unknown";
}

function gitBranch(cwd: string): string | null {
  const result = spawnSync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" });
  return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

export interface AddRecordOptions {
  host?: Host;
  cwd?: string;
  now?: Date;
}

export function addRecord(db: Database, input: RecordInput, options: AddRecordOptions = {}): StoredRecord {
  const cwd = options.cwd ?? process.cwd();
  const repoId = repoIdFromDir(cwd);
  const record: StoredRecord = {
    id: ulid(options.now?.getTime()),
    author: gitAuthor(cwd),
    host: options.host ?? (process.env.PLUGIN_ROOT ? "codex" : "claude-code"),
    product: input.product ?? null,
    repos: input.repos ?? (repoId ? [repoId] : []),
    branch: input.branch ?? gitBranch(cwd),
    type: input.type,
    title: input.title,
    body: input.body,
    entities: input.entities ?? [],
    files: input.files ?? [],
    commits: input.commits ?? [],
    supersedes: input.supersedes ?? null,
    contentHash: contentHash(input),
    createdAt: (options.now ?? new Date()).toISOString(),
  };

  db.transaction(() => {
    db.run(
      `insert into record (id, author, host, product, repos, branch, type, title, body, entities, files, commits, supersedes, content_hash, status, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', ?)`,
      [
        record.id,
        record.author,
        record.host,
        record.product,
        JSON.stringify(record.repos),
        record.branch,
        record.type,
        record.title,
        record.body,
        JSON.stringify(record.entities),
        JSON.stringify(record.files),
        JSON.stringify(record.commits),
        record.supersedes,
        record.contentHash,
        record.createdAt,
      ],
    );
    db.run("insert into fts (body, kind, ref) values (?, 'record', ?)", [
      tokenizeForIndex(`${record.title}\n${record.body}`),
      record.id,
    ]);
  })();

  return record;
}

/** Same title and body as an existing record: the author is saving the same thing twice. */
export function findByContentHash(db: Database, hash: string): string | null {
  const row = db.query("select id from record where content_hash = ?").get(hash) as { id: string } | null;
  return row?.id ?? null;
}
