import { createWorktreeManager } from "../worktree/worktreeManager.js";
import { DEFAULT_SAFETY, ATTEMPT_OUTCOME } from "../constants.js";

/**
 * Pools clean attempt workspaces so successive attempts don't pay the full
 * `git worktree add` cost every time. A successful attempt's workspace is
 * hard-reset and returned to the idle pool (up to poolSize); a failed
 * attempt is either retained for inspection (never pooled — its state is
 * exactly what made it interesting) or destroyed outright.
 */
export function createWorktreePool({
  mainRepoRoot,
  runsRoot,
  commitRef = "HEAD",
  poolSize = DEFAULT_SAFETY.WORKTREE_POOL_SIZE,
  strategy
}) {
  const manager = createWorktreeManager({ mainRepoRoot, runsRoot, strategy });
  const idle = [];
  let liveCount = 0;

  async function acquire() {
    if (idle.length > 0) return idle.pop();
    const workspace = await manager.createAttemptWorkspace({ commitRef });
    liveCount += 1;
    return workspace;
  }

  async function release(workspace, { outcome, retainOnFailure = false } = {}) {
    if (outcome === ATTEMPT_OUTCOME.SUCCESS) {
      if (idle.length < poolSize) {
        await manager.resetWorkspace(workspace, commitRef);
        idle.push(workspace);
        return { pooled: true, retained: false };
      }
      await manager.destroyWorkspace(workspace);
      liveCount -= 1;
      return { pooled: false, retained: false };
    }

    if (retainOnFailure) {
      await manager.retainWorkspace(workspace, "attempt-failed");
      liveCount -= 1;
      return { pooled: false, retained: true, path: workspace.path };
    }

    await manager.destroyWorkspace(workspace);
    liveCount -= 1;
    return { pooled: false, retained: false };
  }

  async function drain() {
    while (idle.length > 0) {
      const workspace = idle.pop();
      await manager.destroyWorkspace(workspace);
      liveCount -= 1;
    }
  }

  return {
    acquire,
    release,
    drain,
    get liveCount() {
      return liveCount;
    },
    get idleCount() {
      return idle.length;
    }
  };
}
