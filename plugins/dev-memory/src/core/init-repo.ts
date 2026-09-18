// Turns an existing repository into a memory repo by adding the missing pieces.
// Never overwrites: the target is usually a repo full of hand-written documentation that
// predates this tool, and those files stay exactly as they are.
import { Glob } from "bun";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export interface InitRepoResult {
  created: string[];
  kept: string[];
}

/** The template ships inside the plugin; CLAUDE_PLUGIN_ROOT is set by both tools. */
export function templateDir(): string {
  const root = process.env.CLAUDE_PLUGIN_ROOT ?? process.env.PLUGIN_ROOT;
  if (root) return join(root, "..", "..", "templates", "memory-repo");
  return join(import.meta.dir, "..", "..", "..", "..", "templates", "memory-repo");
}

export async function initRepo(target: string, options: { templateDir?: string } = {}): Promise<InitRepoResult> {
  const source = options.templateDir ?? templateDir();
  const created: string[] = [];
  const kept: string[] = [];

  for await (const relative of new Glob("**/*").scan({ cwd: source, dot: true })) {
    const from = join(source, relative);
    const to = join(target, relative);

    if (await Bun.file(to).exists()) {
      kept.push(relative);
      continue;
    }
    mkdirSync(dirname(to), { recursive: true });
    await Bun.write(to, Bun.file(from));
    created.push(relative);
  }

  created.sort();
  kept.sort();
  return { created, kept };
}
