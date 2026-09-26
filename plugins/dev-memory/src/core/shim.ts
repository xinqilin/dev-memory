// The CLI as a command: ~/.dev-memory/bin/dm and ~/.dev-memory/bin/dev-memory.
//
// Both tools install the plugin into a versioned cache directory that changes on every update, so a
// fixed path in someone's shell profile goes stale. The session-start hook rewrites these scripts on
// every start instead, always pointing at the copy that is running, for either tool. A plugin bin/
// directory would only reach Claude Code's own shell, not the user's terminal or Codex.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homeDir } from "./config";

const NAMES = ["dm", "dev-memory"];

export function binDir(): string {
  return join(homeDir(), "bin");
}

export function writeShims(cli = join(import.meta.dir, "..", "cli.ts")): void {
  const quoted = `'${cli.replace(/'/g, `'\\''`)}'`;
  const script = `#!/bin/sh\n# Rewritten by dev-memory at every session start, so it follows plugin updates.\nexec bun ${quoted} "$@"\n`;
  mkdirSync(binDir(), { recursive: true });
  for (const name of NAMES) {
    const path = join(binDir(), name);
    if (existsSync(path) && readFileSync(path, "utf8") === script) continue;
    writeFileSync(path, script);
    chmodSync(path, 0o755);
  }
}

export function binDirOnPath(): boolean {
  return (process.env.PATH ?? "").split(":").includes(binDir());
}
