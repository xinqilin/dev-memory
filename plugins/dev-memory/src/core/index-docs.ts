// Make a repo's existing hand-written documents reachable from README.md.
//
// A team adopting this usually points it at a documentation repo that already has years of
// content. Those files stay exactly where they are and keep their own format; all this does is
// list the ones README does not already link to, because README is the only index and lint
// treats an unindexed document as an error. So this command is the fix for that error.
import { Glob } from "bun";
import { join } from "node:path";

const SECTION = "## 既有的人工文件";
const NEXT_SECTION = /^## /m;

/** Never listed: raw material, tooling, the index itself, and instructions written for an agent. */
const SKIP_PREFIXES = ["records/", "node_modules/", "tools/", ".github/"];
const SKIP_FILES = ["README.md", "schema.md"];
const SKIP_NAMES = ["CLAUDE.md", "AGENTS.md"];

export interface IndexDocsResult {
  /** Documents added to the section by this run. */
  docs: string[];
  /** Documents README already linked to, left alone. */
  alreadyIndexed: number;
  indexPath: string;
  changed: boolean;
}

async function title(path: string): Promise<string> {
  const text = await Bun.file(path).text();
  return text.match(/^#\s+(.+)$/m)?.[1].trim() ?? path.split("/").at(-1)!.replace(/\.md$/, "");
}

export async function indexExistingDocs(repo: string): Promise<IndexDocsResult> {
  const indexPath = join(repo, "README.md");
  const readme = (await Bun.file(indexPath).exists()) ? await Bun.file(indexPath).text() : "# 文件索引\n";

  // What the section already holds does not count as indexed: otherwise a second run would
  // see its own output and list nothing, and a removed file could never leave the section.
  const start = readme.indexOf(SECTION);
  const after = start === -1 ? "" : readme.slice(start + SECTION.length);
  const sectionEnd = after.search(NEXT_SECTION);
  const ownSection = start === -1 ? "" : sectionEnd === -1 ? after : after.slice(0, sectionEnd);
  const indexedElsewhere = start === -1 ? readme : readme.replace(ownSection, "");

  const docs: string[] = [];
  let alreadyIndexed = 0;

  for await (const relative of new Glob("**/*.md").scan({ cwd: repo })) {
    if (SKIP_PREFIXES.some((prefix) => relative.startsWith(prefix))) continue;
    if (SKIP_FILES.includes(relative)) continue;
    if (SKIP_NAMES.includes(relative.split("/").at(-1)!)) continue;
    if (indexedElsewhere.includes(relative)) {
      alreadyIndexed++;
      continue;
    }
    docs.push(relative);
  }
  docs.sort();

  const lines = [SECTION, "", "這些是這個 repo 原本就有的文件，保持原本的格式，由人維護。", ""];
  for (const doc of docs) lines.push(`- [${await title(join(repo, doc))}](./${doc})`);
  if (docs.length === 0) lines.push("_沒有還沒被索引到的文件。_");
  lines.push("");

  const next =
    start === -1
      ? `${readme.trimEnd()}\n\n${lines.join("\n")}`
      : `${readme.slice(0, start)}${lines.join("\n")}${sectionEnd === -1 ? "" : `\n${after.slice(sectionEnd)}`}`;

  const changed = next !== readme;
  if (changed) await Bun.write(indexPath, next);
  return { docs, alreadyIndexed, indexPath, changed };
}
