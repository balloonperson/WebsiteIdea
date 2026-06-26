import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { assertPathInsideRoot, assertNotMainWorkingTree } from "../safety/pathValidation.js";
import { WORKTREE_STRATEGIES } from "../constants.js";

/**
 * Minimal git exec helper for runner-internal plumbing (worktree add/remove,
 * reset/clean of pooled workspaces). Always shell:false, args as an array —
 * same rule as processRunner, just not gated by the command allowlist since
 * these are fixed, runner-authored invocations rather than candidate steps.
 */
export function runGitCommand(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`git ${args.join(" ")} failed (exit ${code}): ${stderr.trim()}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Creates and destroys isolated attempt workspaces. Every workspace lives
 * under runsRoot, never inside mainRepoRoot's own working tree, and the
 * manager refuses at construction time if runsRoot resolves to the main
 * tree itself.
 */
export function createWorktreeManager({ mainRepoRoot, runsRoot, strategy = WORKTREE_STRATEGIES.GIT_WORKTREE }) {
  assertNotMainWorkingTree(runsRoot, mainRepoRoot);

  async function ensureRunsRoot() {
    await fs.mkdir(runsRoot, { recursive: true });
  }

  async function createAttemptWorkspace({ commitRef = "HEAD", attemptId = crypto.randomUUID() } = {}) {
    await ensureRunsRoot();
    const worktreePath = assertPathInsideRoot(path.join(runsRoot, attemptId), runsRoot);
    assertNotMainWorkingTree(worktreePath, mainRepoRoot);

    if (strategy === WORKTREE_STRATEGIES.GIT_WORKTREE) {
      await runGitCommand(["worktree", "add", "--detach", worktreePath, commitRef], mainRepoRoot);
      return { path: worktreePath, attemptId, strategy };
    }

    if (strategy === WORKTREE_STRATEGIES.REPO_COPY) {
      await fs.cp(mainRepoRoot, worktreePath, {
        recursive: true,
        filter: (src) => path.basename(src) !== ".git"
      });
      return { path: worktreePath, attemptId, strategy };
    }

    throw new RangeError(`Unknown worktree strategy: ${strategy}`);
  }

  async function destroyWorkspace({ path: worktreePath, strategy: workspaceStrategy }) {
    assertPathInsideRoot(worktreePath, runsRoot);
    assertNotMainWorkingTree(worktreePath, mainRepoRoot);

    if (workspaceStrategy === WORKTREE_STRATEGIES.GIT_WORKTREE) {
      await runGitCommand(["worktree", "remove", "--force", worktreePath], mainRepoRoot).catch(() => {});
    }
    await fs.rm(worktreePath, { recursive: true, force: true });
  }

  async function retainWorkspace({ path: worktreePath }, reason) {
    assertPathInsideRoot(worktreePath, runsRoot);
    const markerPath = path.join(worktreePath, ".worktree-runner-retained.json");
    await fs.writeFile(markerPath, JSON.stringify({ reason, retainedAt: new Date().toISOString() }, null, 2));
  }

  async function resetWorkspace({ path: worktreePath }, commitRef = "HEAD") {
    assertPathInsideRoot(worktreePath, runsRoot);
    assertNotMainWorkingTree(worktreePath, mainRepoRoot);
    await runGitCommand(["reset", "--hard", commitRef], worktreePath);
    await runGitCommand(["clean", "-fdx"], worktreePath);
  }

  return { createAttemptWorkspace, destroyWorkspace, retainWorkspace, resetWorkspace };
}
