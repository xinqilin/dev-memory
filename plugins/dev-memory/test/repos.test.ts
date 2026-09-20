import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configSuggestion, readReposYaml, type ResolvedRepo } from "../src/core/repos";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function repoWith(yaml: string) {
  const dir = mkdtempSync(join(tmpdir(), "dev-memory-repos-"));
  dirs.push(dir);
  await Bun.write(join(dir, "repos.yaml"), yaml);
  return dir;
}

test("reads the table form, including the branch hints", async () => {
  const dir = await repoWith(`products:
  billing:
    repos:
      - id: 104corp/api
        default_branch: dev
      - id: 104corp/batch
        branch_per_job: true
        job_branch_prefix: "job/"
`);

  const entries = (await readReposYaml(dir)).get("billing")!;
  expect(entries).toEqual([
    { id: "104corp/api", defaultBranch: "dev", branchPerJob: false, jobBranchPrefix: "batch/" },
    { id: "104corp/batch", defaultBranch: "main", branchPerJob: true, jobBranchPrefix: "job/" },
  ]);
});

test("still reads the older bare-string form", async () => {
  const dir = await repoWith(`products:
  billing:
    repos:
      - 104corp/api
`);

  const entries = (await readReposYaml(dir)).get("billing")!;
  expect(entries).toEqual([{ id: "104corp/api", defaultBranch: "main", branchPerJob: false, jobBranchPrefix: "batch/" }]);
});

test("a repo with no repos.yaml yields nothing rather than throwing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dev-memory-repos-"));
  dirs.push(dir);
  expect((await readReposYaml(dir)).size).toBe(0);
});

test("the suggestion names every missing repo and nothing else", () => {
  const resolved: ResolvedRepo[] = [
    { id: "104corp/api", defaultBranch: "dev", branchPerJob: false, jobBranchPrefix: "batch/", path: "/x/api", via: "config" },
    { id: "104corp/batch", defaultBranch: "main", branchPerJob: true, jobBranchPrefix: "batch/", path: null, via: null },
  ];

  const suggestion = configSuggestion(resolved)!;
  expect(suggestion).toContain("[repos]");
  expect(suggestion).toContain('"104corp/batch"');
  expect(suggestion).not.toContain("104corp/api"); // already resolved, nothing to add
});

test("nothing to suggest when everything resolved", () => {
  const resolved: ResolvedRepo[] = [
    { id: "104corp/api", defaultBranch: "dev", branchPerJob: false, jobBranchPrefix: "batch/", path: "/x/api", via: "scan" },
  ];
  expect(configSuggestion(resolved)).toBeNull();
});
