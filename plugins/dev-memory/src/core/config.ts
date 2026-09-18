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
}

export const DEFAULT_CONFIG: Config = {
  embedding: { provider: "none", model: null, endpoint: "http://127.0.0.1:11434" },
  memory: { repo: null, branch: "main" },
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
  }>;
  const embedding = parsed.embedding ?? {};
  const memory = parsed.memory ?? {};
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
  };
}
