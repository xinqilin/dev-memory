import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parseClaudeTranscript } from "../src/adapters/claude-code";
import { parseCodexRollout } from "../src/adapters/codex";

const FIXTURES = join(import.meta.dir, "fixtures");
const read = (...parts: string[]) => Bun.file(join(FIXTURES, ...parts)).text();
const stubRepo = () => "example-org/example-repo";

describe("claude-code adapter", () => {
  test("keeps only what the author and the agent actually said", async () => {
    const turns = parseClaudeTranscript(await read("claude-code", "session.jsonl"), { resolveRepoId: stubRepo });

    expect(turns.map((t) => [t.role, t.text])).toEqual([
      ["user", "匯出報表失敗時不要整批中斷，改成記下來繼續跑"],
      ["agent", "決定：單筆失敗寫進 failedRows，整批照跑；放棄原本的整批 rollback"],
      ["user", "順便把 retry 次數設成 3"], // the system-reminder block is stripped, the prompt stays
    ]);
  });

  test("ids carry the file line number, so a broken line does not shift them", async () => {
    const turns = parseClaudeTranscript(await read("claude-code", "session.jsonl"), { resolveRepoId: stubRepo });
    expect(turns.map((t) => t.id)).toEqual([
      "claude-code:sess-fixture-1:1",
      "claude-code:sess-fixture-1:6",
      "claude-code:sess-fixture-1:12",
    ]);
  });

  test("carries cwd, branch, repo and timestamp", async () => {
    const [first] = parseClaudeTranscript(await read("claude-code", "session.jsonl"), { resolveRepoId: stubRepo });
    expect(first).toMatchObject({
      host: "claude-code",
      sessionId: "sess-fixture-1",
      cwd: "/Users/demo/project-alpha",
      branch: "feature/export-report",
      repoId: "example-org/example-repo",
      ts: "2026-09-18T01:00:00.000Z",
    });
  });

  test("resolves the repo once per cwd", async () => {
    let calls = 0;
    parseClaudeTranscript(await read("claude-code", "session.jsonl"), {
      resolveRepoId: () => {
        calls++;
        return null;
      },
    });
    expect(calls).toBe(1);
  });

  test("startLineNo supports reading a chunk from the middle of a file", () => {
    const line = `{"type":"user","sessionId":"s","timestamp":null,"cwd":null,"message":{"role":"user","content":"後來加的"}}`;
    const [turn] = parseClaudeTranscript(line, { startLineNo: 41, resolveRepoId: stubRepo });
    expect(turn.lineNo).toBe(41);
    expect(turn.id).toBe("claude-code:s:41");
    expect(turn.repoId).toBeNull();
  });
});

describe("codex adapter", () => {
  test("prefers event_msg and drops the response_item duplicate", async () => {
    const { turns } = parseCodexRollout(await read("codex", "rollout.jsonl"));
    expect(turns.map((t) => [t.role, t.text])).toEqual([
      ["user", "匯出報表失敗時不要整批中斷"],
      ["agent", "決定：單筆失敗寫進 failedRows，整批繼續；retry 上限 3 次"],
    ]);
  });

  test("session_meta fills repo, branch, cwd and session id", async () => {
    const { turns, context } = parseCodexRollout(await read("codex", "rollout.jsonl"));
    expect(context).toEqual({
      sessionId: "01999000-fixture-codex",
      cwd: "/Users/demo/project-alpha",
      repoId: "example-org/example-repo",
      branch: "feature/export-report",
    });
    expect(turns[0]).toMatchObject({ host: "codex", id: "codex:01999000-fixture-codex:3", repoId: "example-org/example-repo" });
  });

  test("a directory outside git gets a null repo, and response_item fills in for a missing event_msg", async () => {
    const { turns, context } = parseCodexRollout(await read("codex", "rollout-no-git.jsonl"));
    expect(context.repoId).toBeNull();
    expect(turns.map((t) => [t.role, t.text])).toEqual([
      ["user", "在非 git 目錄裡問問題"],
      ["agent", "沒有 git 就不記 repo，之後預設不提交"], // only response_item carries this one
    ]);
  });

  test("turn_context can move the cwd mid-session", () => {
    const content = [
      `{"type":"session_meta","timestamp":"t0","payload":{"session_id":"s","cwd":"/a","git":null}}`,
      `{"type":"turn_context","timestamp":"t1","payload":{"cwd":"/b"}}`,
      `{"type":"event_msg","timestamp":"t2","payload":{"type":"user_message","message":"換目錄之後"}}`,
    ].join("\n");
    const { turns } = parseCodexRollout(content);
    expect(turns[0].cwd).toBe("/b");
  });

  test("a chunk without session_meta inherits the context of the previous chunk", () => {
    const content = `{"type":"event_msg","timestamp":"t","payload":{"type":"agent_message","message":"接著上一段"}}`;
    const { turns } = parseCodexRollout(content, {
      startLineNo: 87,
      context: { sessionId: "s9", cwd: "/repo", repoId: "example-org/example-repo", branch: "main" },
    });
    expect(turns[0]).toMatchObject({ id: "codex:s9:87", repoId: "example-org/example-repo", branch: "main" });
  });
});
