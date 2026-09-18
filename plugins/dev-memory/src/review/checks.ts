// What must be true before a page can be approved. The CI in the memory repo checks the same
// things, but finding a leaked key here means it never reaches GitHub at all.

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

const PAGE_TYPES = new Set(["overview", "feature", "decision", "entity", "repo", "runbook"]);
const PAGE_STATUS = new Set(["active", "superseded"]);

export function checkPage(path: string, content: string): Check[] {
  const checks: Check[] = [];

  for (const [pattern, what] of SECRET_PATTERNS) {
    if (pattern.test(content)) checks.push({ level: "error", message: `疑似機密：${what}` });
  }
  for (const [pattern, what] of PII_PATTERNS) {
    if (pattern.test(content)) checks.push({ level: "warning", message: `疑似個資：${what}` });
  }

  // index.md and log.md are navigation, not pages, so they have no frontmatter.
  if (/\/(index|log)\.md$/.test(path)) return checks;

  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    checks.push({ level: "error", message: "缺少 YAML frontmatter" });
    return checks;
  }

  let frontmatter: Record<string, any>;
  try {
    frontmatter = (Bun.YAML.parse(match[1]) ?? {}) as Record<string, any>;
  } catch (error) {
    checks.push({ level: "error", message: `frontmatter 不是合法 YAML：${error}` });
    return checks;
  }

  for (const field of ["type", "title", "status", "updated"]) {
    if (!frontmatter[field]) checks.push({ level: "error", message: `frontmatter 缺少 ${field}` });
  }
  if (frontmatter.type && !PAGE_TYPES.has(frontmatter.type)) {
    checks.push({ level: "error", message: `type "${frontmatter.type}" 不是合法的種類` });
  }
  if (frontmatter.status && !PAGE_STATUS.has(frontmatter.status)) {
    checks.push({ level: "error", message: `status "${frontmatter.status}" 不是合法的狀態` });
  }
  if (frontmatter.status === "superseded" && !frontmatter.superseded_by) {
    checks.push({ level: "error", message: "標成 superseded 就要填 superseded_by" });
  }
  if (!Array.isArray(frontmatter.sources) || frontmatter.sources.length === 0) {
    checks.push({ level: "warning", message: "沒有 sources[]，之後沒辦法追這頁的內容從哪來" });
  }
  if (!match[2].trim()) {
    checks.push({ level: "error", message: "頁面沒有內容" });
  }

  return checks;
}

export function hasErrors(checks: Check[]): boolean {
  return checks.some((check) => check.level === "error");
}
