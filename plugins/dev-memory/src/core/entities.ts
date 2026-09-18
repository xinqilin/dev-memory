// Entities are the crossroads of a cross-repo codebase: a table, an API, a queue, an external
// system. The question worth answering is "who writes it, who reads it" — that is what nobody
// can see from a single repository.
//
// This only reports what the records actually say. Whether a repo reads or writes is something
// the author states in the record; it is never guessed here.
import type { Database } from "bun:sqlite";

export type EntityKind = "table" | "api" | "queue" | "external" | string;

export interface EntityUse {
  repo: string;
  access: "read" | "write" | "unknown";
  recordId: string;
}

export interface EntitySummary {
  kind: EntityKind;
  name: string;
  slug: string;
  uses: EntityUse[];
  recordIds: string[];
  lastSeen: string;
  writers: string[];
  readers: string[];
}

// Underscores survive: an entity name is usually an identifier (export_job), and the page file
// should read like the thing it describes.
export function entitySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface RecordRow {
  id: string;
  repos: string;
  entities: string;
  created_at: string;
}

export function entityIndex(db: Database, options: { product?: string } = {}): EntitySummary[] {
  const rows = (
    options.product
      ? db.query("select id, repos, entities, created_at from record where product = ? order by created_at").all(options.product)
      : db.query("select id, repos, entities, created_at from record order by created_at").all()
  ) as RecordRow[];

  const found = new Map<string, EntitySummary>();

  for (const row of rows) {
    let entities: { kind?: string; name?: string; access?: string }[];
    let repos: string[];
    try {
      entities = JSON.parse(row.entities);
      repos = JSON.parse(row.repos);
    } catch {
      continue; // a malformed row must not break the whole index
    }
    if (!Array.isArray(entities)) continue;

    for (const entity of entities) {
      if (!entity?.name) continue;
      const kind = entity.kind ?? "external";
      const key = `${kind}:${entity.name}`;
      const summary =
        found.get(key) ??
        ({ kind, name: entity.name, slug: entitySlug(entity.name), uses: [], recordIds: [], lastSeen: row.created_at, writers: [], readers: [] } as EntitySummary);

      const access = entity.access === "read" || entity.access === "write" ? entity.access : "unknown";
      for (const repo of repos.length > 0 ? repos : ["(不在 git 裡)"]) {
        summary.uses.push({ repo, access, recordId: row.id });
        if (access === "write" && !summary.writers.includes(repo)) summary.writers.push(repo);
        if (access === "read" && !summary.readers.includes(repo)) summary.readers.push(repo);
      }
      summary.recordIds.push(row.id);
      if (row.created_at > summary.lastSeen) summary.lastSeen = row.created_at;
      found.set(key, summary);
    }
  }

  return [...found.values()].sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind.localeCompare(b.kind)));
}

/** Which entities have no page yet, so ingest knows what to propose. */
export function missingEntityPages(db: Database, entities: EntitySummary[]): EntitySummary[] {
  const pages = (db.query("select path from page where type = 'entity'").all() as { path: string }[]).map((row) => row.path);
  return entities.filter((entity) => !pages.some((path) => path.endsWith(`/${entity.slug}.md`)));
}
