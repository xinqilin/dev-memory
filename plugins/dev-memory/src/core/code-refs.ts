// A document's 程式碼位置 table: which repo, which branch, which path it describes.
//
// It is ordinary markdown a person reads, so the parser follows how people write it: 同上 repeats
// the cell above, backticks are decoration, and env-{dev,prod}.sh means two files. stale reads the
// table to compare against the code; lint reads it to say when a row cannot be understood.
export interface CodeRef {
  repo: string;
  branch: string;
  path: string;
}

export interface CodeRefTable {
  refs: CodeRef[];
  /** Why some rows could not be read; lint reports these. */
  problems: string[];
}

const HEADING = /^(#{2,6})\s+.*程式碼位置/;
const DITTO = "同上";

const isRow = (line: string) => line.trim().startsWith("|");
const cellsOf = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim().replace(/^`(.*)`$/, "$1").trim());

/** `env-{dev,prod}.sh` is two paths. One level of braces is all the tables use. */
function expandBraces(path: string): string[] {
  const match = path.match(/^(.*)\{([^{}]+)\}(.*)$/);
  return match ? match[2].split(",").map((option) => `${match[1]}${option.trim()}${match[3]}`) : [path];
}

/** The rows of a document's 程式碼位置 table, or null when it has none (most hand-written docs). */
export function parseCodeRefs(markdown: string): CodeRefTable | null {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => HEADING.test(line));
  if (start === -1) return null;
  const level = lines[start].match(HEADING)![1].length;

  let at = start + 1;
  for (; at < lines.length; at++) {
    const heading = lines[at].match(/^(#+)\s/);
    if (heading && heading[1].length <= level) return null; // the section ended without a table
    if (isRow(lines[at]) && cellsOf(lines[at]).some((cell) => /^repo$/i.test(cell))) break;
  }
  if (at >= lines.length) return null;

  const header = cellsOf(lines[at]);
  const column = {
    repo: header.findIndex((cell) => /^repo$/i.test(cell)),
    branch: header.indexOf("分支"),
    path: header.indexOf("路徑"),
  };
  const problems: string[] = [];
  if (column.branch === -1) problems.push("程式碼位置表缺「分支」欄");
  if (column.path === -1) problems.push("程式碼位置表缺「路徑」欄");
  if (problems.length > 0) return { refs: [], problems };

  const refs: CodeRef[] = [];
  let previous: CodeRef = { repo: "", branch: "", path: "" };
  let row = 0;
  for (at++; at < lines.length && isRow(lines[at]); at++) {
    const cells = cellsOf(lines[at]);
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue; // the |---| separator
    row++;
    const pick = (key: keyof CodeRef) => {
      const value = cells[column[key]] ?? "";
      return value === DITTO ? previous[key] : value;
    };
    const current = { repo: pick("repo"), branch: pick("branch"), path: pick("path") };
    if (!current.repo || !current.branch || !current.path) {
      problems.push(`程式碼位置表第 ${row} 列缺 repo、分支或路徑`);
      continue;
    }
    previous = current;
    for (const path of expandBraces(current.path)) refs.push({ ...current, path });
  }
  return { refs, problems };
}
