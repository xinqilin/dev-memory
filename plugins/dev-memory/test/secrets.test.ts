import { expect, test } from "bun:test";
import { redactSecrets } from "../src/core/secrets";

test("each kind of secret is masked with its name", () => {
  const text = [
    "key AKIAIOSFODNN7EXAMPLE here",
    "gh ghp_abcdefghijklmnopqrstuvwxyz123456",
    'password = "hunter2hunter2"',
    "db postgres://app:s3cret@db.internal:5432/billing",
  ].join("\n");

  const masked = redactSecrets(text);

  expect(masked).toContain("[REDACTED:AWS access key id]");
  expect(masked).toContain("[REDACTED:GitHub token]");
  expect(masked).toContain("[REDACTED:hard-coded credential]");
  expect(masked).toContain("[REDACTED:credentials inside a URL]db.internal:5432/billing");
  for (const secret of ["AKIAIOSFODNN7EXAMPLE", "ghp_abcdefghijklmnopqrstuvwxyz123456", "hunter2hunter2", "s3cret"]) {
    expect(masked).not.toContain(secret);
  }
});

test("a private key is masked as a whole block, not just its header", () => {
  const text = "before\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234\n-----END RSA PRIVATE KEY-----\nafter";
  expect(redactSecrets(text)).toBe("before\n[REDACTED:private key]\nafter");
});

test("a key pasted without its end line is masked to the end of the text", () => {
  expect(redactSecrets("-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEA")).toBe("[REDACTED:private key]");
});

test("every occurrence is masked, and masking twice changes nothing more", () => {
  const once = redactSecrets("ghp_aaaaaaaaaaaaaaaaaaaa and ghp_bbbbbbbbbbbbbbbbbbbb");
  expect(once).toBe("[REDACTED:GitHub token] and [REDACTED:GitHub token]");
  expect(redactSecrets(once)).toBe(once);
});

test("ordinary conversation is left alone", () => {
  const text = "invoiceStatus 維持 WAIT_FOR_INSERT_STAGING_DB；token 放在 header，不寫進 config";
  expect(redactSecrets(text)).toBe(text);
});
