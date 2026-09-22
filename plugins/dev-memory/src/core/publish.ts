// Pushing and opening the PR. This is the one place that talks to GitHub, and it only ever runs
// because a person asked for it: the review page's button, or `dev-memory publish` typed by hand.
// The skills state that the agent must not call it.
import { spawnSync } from "node:child_process";

export interface PublishResult {
  url?: string;
  message: string;
}

function run(cwd: string, command: string, args: string[]): { ok: boolean; out: string } {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  return { ok: result.status === 0, out: `${result.stdout}${result.stderr}`.trim() };
}

export interface PublishOptions {
  title?: string;
  body?: string;
  base?: string;
  /** Skipped in tests, where there is no gh and no GitHub. */
  openPr?: boolean;
}

export function publish(worktree: string, branch: string, options: PublishOptions = {}): PublishResult {
  const base = options.base ?? "main";

  const dirty = run(worktree, "git", ["status", "--porcelain"]);
  if (dirty.ok && dirty.out) {
    throw new Error("還有沒 commit 的修改，請先在審核頁按「核准並 commit」");
  }

  const ahead = run(worktree, "git", ["log", "--oneline", `origin/${base}..HEAD`]);
  if (ahead.ok && !ahead.out) {
    throw new Error(`這個 branch 跟 origin/${base} 一樣，沒有東西可以送出`);
  }

  const push = run(worktree, "git", ["push", "-u", "origin", branch]);
  if (!push.ok) throw new Error(`push 失敗：${push.out}`);

  if (options.openPr === false) return { message: `已 push ${branch}` };

  const title = options.title ?? `memory: ${branch.split("/").at(-1)}`;
  const body =
    options.body ??
    ["這個 PR 由 dev-memory 產生。", "", "- 紀錄：`records/`", "- 文件：見 `README.md` 索引", "", "作者已在本機審核頁確認過內容。"].join("\n");

  const pr = run(worktree, "gh", ["pr", "create", "--base", base, "--head", branch, "--title", title, "--body", body]);
  if (!pr.ok) {
    // gh missing or not logged in: the push already happened, so say what is left to do.
    return { message: `已 push ${branch}，但開 PR 失敗：${pr.out}\n可以自己開：gh pr create --base ${base} --head ${branch}` };
  }

  const url = pr.out.split(/\s+/).find((token) => token.startsWith("https://"));
  return { url, message: url ? `PR 已開：${url}` : pr.out };
}
