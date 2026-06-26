// Shared enums and defaults for the worktree runner. Mirrors the
// conservative-by-default posture of evolution-core's constants.js: every
// safety knob here has a restrictive default that callers must deliberately
// widen, never the other way around.

export const WORKTREE_STRATEGIES = Object.freeze({
  GIT_WORKTREE: "git-worktree",
  REPO_COPY: "repo-copy"
});

export const VERIFICATION_SCOPE = Object.freeze({
  BUILD_ONLY: "build-only",
  BUILD_AND_TESTS: "build-and-tests",
  FULL_BEHAVIOR: "full-behavior"
});

export const ATTEMPT_OUTCOME = Object.freeze({
  SUCCESS: "success",
  FAILURE: "failure"
});

export const DEFAULT_SAFETY = Object.freeze({
  COMMAND_ALLOWLIST: Object.freeze(["node", "npm", "npx", "git", "yarn", "pnpm"]),
  ENV_ALLOWLIST: Object.freeze(["PATH", "HOME", "NODE_ENV", "LANG"]),
  TIMEOUT_MS: 120_000,
  MAX_OUTPUT_BYTES: 2 * 1024 * 1024,
  MAX_CONCURRENT_ATTEMPTS: 2,
  WORKTREE_POOL_SIZE: 2,
  // git subcommands an attempt is never allowed to invoke, even if "git" is
  // on the command allowlist for build/test steps.
  DISALLOWED_GIT_SUBCOMMANDS: Object.freeze(["push", "remote", "fetch", "clone", "submodule"])
});

export const DEFAULT_DUAL_MODE = Object.freeze({
  DUAL_SIMULATED_SPLIT: 0.7,
  DUAL_REAL_SPLIT: 0.3,
  MIN_REAL_VERIFICATION_RESERVE: 0
});
