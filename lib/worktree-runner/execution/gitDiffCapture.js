import { runGitCommand } from "../worktree/worktreeManager.js";

/**
 * Lists files changed in an attempt workspace relative to its checked-out
 * commit. Read-only `git status`/`git diff` — never invoked against the
 * main working tree by any caller in this module.
 */
export async function captureChangedFiles(cwd) {
  const output = await runGitCommand(["status", "--porcelain"], cwd);
  if (!output) return [];
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => ({ status: line.slice(0, 2).trim(), file: line.slice(3) }));
}

export async function captureDiff(cwd) {
  return runGitCommand(["diff", "HEAD"], cwd);
}
