// Hooks swallow every error, because a session must never fail over the memory. A swallowed error
// still has to show up somewhere, or "nothing is being recorded" has no explanation: it is kept
// here, and `dev-memory setup` shows the latest one.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homeDir } from "./config";

const KEEP_LINES = 200;

export function hookLogPath(): string {
  return join(homeDir(), "hook.log");
}

export function logHookError(hook: string, error: unknown): void {
  console.error(`dev-memory ${hook} hook: ${error}`);
  try {
    const path = hookLogPath();
    mkdirSync(dirname(path), { recursive: true });
    const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean) : [];
    lines.push(`${new Date().toISOString()} ${hook}: ${String(error).replace(/\s+/g, " ")}`);
    writeFileSync(path, `${lines.slice(-KEEP_LINES).join("\n")}\n`);
  } catch {
    // nowhere left to report it; stderr above is all there is
  }
}

/** The newest entry, or null when the hooks have never failed. */
export function lastHookError(): { at: Date; message: string } | null {
  const path = hookLogPath();
  if (!existsSync(path)) return null;
  const last = readFileSync(path, "utf8").trim().split("\n").at(-1) ?? "";
  const space = last.indexOf(" ");
  const at = new Date(last.slice(0, space));
  return space === -1 || Number.isNaN(at.getTime()) ? null : { at, message: last.slice(space + 1) };
}
