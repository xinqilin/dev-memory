// User data always lives in ~/.dev-memory, never in the plugin directory:
// the plugin is copied to every machine that installs it.
// DEV_MEMORY_HOME overrides the location, which is what the tests use.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type EmbeddingProvider = "none" | "ollama";

export interface Config {
  embedding: {
    provider: EmbeddingProvider;
    model: string | null;
    endpoint: string;
  };
  /** Local clone of the memory repo; sync and publish work against it. */
  memory: {
    repo: string | null;
    branch: string;
  };
  /**
   * Where this machine keeps its clone of each code repo, keyed by "owner/repo".
   * Per-machine on purpose: repos.yaml is shared with the whole team, and everyone
   * clones somewhere different. Filled by `dev-memory setup`, editable by hand.
   */
  repos: Record<string, string>;
  /** Sessions whose working directory is under one of these are never collected. */
  capture: {
    exclude: string[];
  };
}

export const DEFAULT_CONFIG: Config = {
  embedding: { provider: "none", model: null, endpoint: "http://127.0.0.1:11434" },
  memory: { repo: null, branch: "main" },
  repos: {},
  capture: { exclude: [] },
};

// Bun parses TOML but cannot serialize it (1.3.4), so the default file is a template.
const CONFIG_TEMPLATE = `# dev-memory configuration
# Semantic search is opt-in. Run \`dev-memory setup\` to choose a provider.

[embedding]
provider = "none"                     # "none" | "ollama"
model = ""                            # e.g. "qwen3-embedding:0.6b" when provider = "ollama"
endpoint = "http://127.0.0.1:11434"

[memory]
repo = ""                             # path to your clone of the memory repo
branch = "main"

# Where your clones of the code repos live, so documents can be written from the source.
# \`dev-memory setup\` fills this in by scanning the usual places; add anything it missed.
[repos]
# "104corp/example-service" = "~/project-backend/example-service"

# Conversations in these directories are never collected: a private project, a customer's code.
# Only affects what is collected from now on.
[capture]
exclude = []                          # e.g. ["~/personal", "~/project-other/customer-x"]
`;

export function homeDir(): string {
  return process.env.DEV_MEMORY_HOME ?? join(homedir(), ".dev-memory");
}

export function dbPath(): string {
  return join(homeDir(), "memory.db");
}

export function configPath(): string {
  return join(homeDir(), "config.toml");
}

export function ensureHomeDir(): string {
  const dir = homeDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Writes the default config when there is none. Never overwrites an existing file. */
export async function ensureConfig(): Promise<{ path: string; created: boolean }> {
  ensureHomeDir();
  const path = configPath();
  if (await Bun.file(path).exists()) return { path, created: false };
  await Bun.write(path, CONFIG_TEMPLATE);
  return { path, created: true };
}

export async function loadConfig(): Promise<Config> {
  const file = Bun.file(configPath());
  if (!(await file.exists())) return DEFAULT_CONFIG;

  const parsed = Bun.TOML.parse(await file.text()) as Partial<{
    embedding: Partial<Config["embedding"]>;
    memory: Partial<Config["memory"]>;
    repos: Record<string, unknown>;
    capture: Partial<{ exclude: unknown }>;
  }>;
  const embedding = parsed.embedding ?? {};
  const memory = parsed.memory ?? {};
  const repos: Record<string, string> = {};
  for (const [id, path] of Object.entries(parsed.repos ?? {})) {
    if (typeof path === "string" && path.trim()) repos[id] = expandHome(path.trim());
  }
  return {
    embedding: {
      provider: embedding.provider === "ollama" ? "ollama" : "none",
      model: embedding.model ? String(embedding.model) : null,
      endpoint: embedding.endpoint ? String(embedding.endpoint) : DEFAULT_CONFIG.embedding.endpoint,
    },
    memory: {
      repo: memory.repo ? String(memory.repo) : null,
      branch: memory.branch ? String(memory.branch) : DEFAULT_CONFIG.memory.branch,
    },
    repos,
    capture: {
      exclude: Array.isArray(parsed.capture?.exclude)
        ? parsed.capture.exclude.filter((dir): dir is string => typeof dir === "string" && dir.trim() !== "").map((dir) => expandHome(dir.trim()))
        : [],
    },
  };
}

/** "~/x" is what people type in a config file; nothing downstream understands it. */
export function expandHome(path: string): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}
