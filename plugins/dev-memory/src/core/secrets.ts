// Strings that must never be kept or published: shared by the review page, which refuses to approve
// a file that has one, and the archive, which masks them before a turn is stored.
//
// The plugin itself holds no credentials. These come from conversations: a connection string or a
// token pasted into a prompt would otherwise sit in memory.db long after the transcript is gone.

export const SECRET_PATTERNS: [RegExp, string][] = [
  [/AKIA[0-9A-Z]{16}/, "AWS access key id"],
  [/aws_secret_access_key\s*[:=]\s*\S+/i, "AWS secret access key"],
  [/gh[pousr]_[A-Za-z0-9]{16,}/, "GitHub token"],
  [/github_pat_[A-Za-z0-9_]{20,}/, "GitHub fine-grained token"],
  [/-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, "private key"],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/(password|passwd|secret|token)\s*[:=]\s*["'][^"'\s]{8,}["']/i, "hard-coded credential"],
  [/[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/\s:@]+:[^/\s:@]+@/, "credentials inside a URL"],
];

// The header is enough to refuse a file, but masking only the header would keep the key itself.
const PRIVATE_KEY_BLOCK = /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?(?:-----END \1?PRIVATE KEY-----|$)/g;

/** Replaces every match with [REDACTED:<kind>]. Errs on the side of masking too much. */
export function redactSecrets(text: string): string {
  let masked = text.replace(PRIVATE_KEY_BLOCK, "[REDACTED:private key]");
  for (const [pattern, what] of SECRET_PATTERNS) {
    masked = masked.replace(new RegExp(pattern.source, `${pattern.flags}g`), `[REDACTED:${what}]`);
  }
  return masked;
}
