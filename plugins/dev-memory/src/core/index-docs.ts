// Listing a repo's existing hand-written docs in wiki/index.md.
//
// The memory repo is an existing documentation repo: those files stay exactly where they are and
// keep their own format. All we do is make them reachable from the page the agent reads first.
import { Glob } from "bun";
import { join } from "node:path";

const SECTION = "## 既有的人工文件";
const MARKER_END = /^## /m;

export interface IndexDocsResult {
  docs: string[];
  indexPath: string;
  changed: boolean;
}

async function title(path: string): Promise<string> {
  const text = await Bun.file(path).text();
  const heading = text.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : path.split("/").at(-1)!.replace(/\.md$/, "");
}

export async function indexExistingDocs(repo: string): Promise<IndexDocsResult> {
  const indexPath = join(repo, "wiki", "index.md");
  const docs: string[] = [];

  for await (const relative of new Glob("**/*.md").scan({ cwd: repo })) {
    if (relative.startsWith("wiki/") || relative.startsWith("records/") || relative.startsWith("node_modules/")) continue;
    if (relative === "schema.md" || relative === "README.md") continue;
    docs.push(relative);
  }
  docs.sort();

  const lines: string[] = [SECTION, "", "這些是這個 repo 原本就有的文件，保持原本的格式，由人維護。", ""];
  for (const doc of docs) {
    lines.push(`- [${await title(join(repo, doc))}](../${doc})`);
  }
  if (docs.length === 0) lines.push("_目前沒有。_");
  lines.push("");

  const current = (await Bun.file(indexPath).exists()) ? await Bun.file(indexPath).text() : `# 開發記憶總目錄\n\n`;
  const start = current.indexOf(SECTION);

  let next: string;
  if (start === -1) {
    next = `${current.trimEnd()}\n\n${lines.join("\n")}`;
  } else {
    const after = current.slice(start + SECTION.length);
    const nextSection = after.search(MARKER_END);
    const tail = nextSection === -1 ? "" : after.slice(nextSection);
    next = `${current.slice(0, start)}${lines.join("\n")}${tail ? `\n${tail}` : ""}`;
  }

  const changed = next !== current;
  if (changed) await Bun.write(indexPath, next);
  return { docs, indexPath, changed };
}
