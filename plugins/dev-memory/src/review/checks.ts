// What must be true before an ingest can be approved. The CI in the memory repo checks the same
// things, but finding a leaked key here means it never reaches GitHub at all.
//
// Different files have different rules: a wiki page needs frontmatter, a records file must be
// valid JSONL, and everything else (repos.yaml, .gitattributes) only gets the secret scan.

export interface Check {
  level: "error" | "warning";
  message: string;
}

const SECRET_PATTERNS: [RegExp, string][] = [
  [/AKIA[0-9A-Z]{16}/, "AWS access key id"],
  [/aws_secret_access_key\s*[:=]\s*\S+/i, "AWS secret access key"],
  [/gh[pousr]_[A-Za-z0-9]{16,}/, "GitHub token"],
  [/github_pat_[A-Za-z0-9_]{20,}/, "GitHub fine-grained token"],
  [/-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, "private key"],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/(password|passwd|secret|token)\s*[:=]\s*["'][^"'\s]{8,}["']/i, "hard-coded credential"],
  [/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]+@/, "credentials inside a URL"],
];

// Taiwan ID and phone numbers: the most likely personal data to slip in from a support case.
const PII_PATTERNS: [RegExp, string][] = [
  [/\b[A-Z][12]\d{8}\b/, "看起來像身分證字號"],
  [/\b09\d{2}-?\d{3}-?\d{3}\b/, "看起來像手機號碼"],
];

// Directories that hold documents. Everything else is config or tooling.
const DOC_DIRS = ["spec/", "maintenance/", "guidelines/", "config/", "dr/", "bank/", "poc/"];
const REQUIRED_RECORD_FIELDS = ["id", "author", "host", "type", "title", "body", "content_hash", "created_at"];

/** A document someone will read. Docs carry no frontmatter — they are prose, not data. */
function isDoc(path: string): boolean {
  return path.endsWith(".md") && DOC_DIRS.some((dir) => path.startsWith(dir));
}

function isRecordsFile(path: string): boolean {
  return path.startsWith("records/") && path.endsWith(".jsonl");
}

function scanSecrets(content: string): Check[] {
  const checks: Check[] = [];
  for (const [pattern, what] of SECRET_PATTERNS) {
    if (pattern.test(content)) checks.push({ level: "error", message: `疑似機密：${what}` });
  }
  for (const [pattern, what] of PII_PATTERNS) {
    if (pattern.test(content)) checks.push({ level: "warning", message: `疑似個資：${what}` });
  }
  return checks;
}

function checkRecords(content: string): Check[] {
  const checks: Check[] = [];
  content.split("\n").forEach((line, index) => {
    if (!line.trim()) return;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line);
    } catch (error) {
      checks.push({ level: "error", message: `第 ${index + 1} 行不是合法 JSON：${error}` });
      return;
    }
    const missing = REQUIRED_RECORD_FIELDS.filter((field) => !record[field]);
    if (missing.length > 0) checks.push({ level: "error", message: `第 ${index + 1} 行缺少欄位：${missing.join("、")}` });
  });
  return checks;
}

/**
 * A document is prose, so there is no schema to validate. What can still be checked is whether
 * it would be useful: a title, some body, and no leftover frontmatter block from the old layout.
 */
function checkDoc(content: string): Check[] {
  const checks: Check[] = [];
  if (content.startsWith("---\n")) {
    checks.push({ level: "warning", message: "文件開頭有 frontmatter，GitHub 會把它渲染成一大張表格" });
  }
  if (!/^#\s+\S/m.test(content)) {
    checks.push({ level: "error", message: "沒有標題（第一層 # 標題）" });
  }
  if (content.replace(/^---\n[\s\S]*?\n---\n/, "").trim().length < 40) {
    checks.push({ level: "error", message: "文件沒有內容" });
  }
  if (/```[a-z]*\n(?:.*\n){60,}?```/.test(content)) {
    checks.push({ level: "warning", message: "有超過 60 行的程式碼區塊，貼大段程式碼會馬上過期" });
  }
  return checks;
}

export function checkFile(path: string, content: string): Check[] {
  const checks = scanSecrets(content);
  if (isRecordsFile(path)) return [...checks, ...checkRecords(content)];
  if (isDoc(path)) return [...checks, ...checkDoc(content)];
  return checks; // README.md, repos.yaml, schema.md: the secret scan is the whole rule
}

export function hasErrors(checks: Check[]): boolean {
  return checks.some((check) => check.level === "error");
}
