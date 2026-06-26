import { DEFAULT_SAFETY } from "../constants.js";

export class CommandNotAllowedError extends Error {}

/**
 * Commands are never built from interpolated shell strings in this runner —
 * args always travel as an array straight to child_process.spawn with
 * shell:false. This only validates the array shape; it does not sanitize
 * for shell metacharacters because there is no shell to interpret them.
 */
export function assertArgsAreSafe(args) {
  if (!Array.isArray(args)) {
    throw new TypeError("Command args must be an array, not an interpolated shell string.");
  }
  for (const arg of args) {
    if (typeof arg !== "string") {
      throw new TypeError(`Command arg must be a string, got ${typeof arg}.`);
    }
  }
}

export function assertCommandAllowed(command, allowlist = DEFAULT_SAFETY.COMMAND_ALLOWLIST) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) {
    throw new CommandNotAllowedError("Command allowlist is empty; refusing to run anything.");
  }
  if (typeof command !== "string" || !allowlist.includes(command)) {
    throw new CommandNotAllowedError(`Command "${command}" is not in the allowlist: [${allowlist.join(", ")}].`);
  }
}

/**
 * Even when "git" is allowlisted for build/test steps, an attempt must never
 * be able to push, add a remote, fetch, clone, or touch submodules — those
 * are the operations that would let a sandboxed attempt reach outside its
 * own isolated worktree.
 */
export function assertGitSubcommandAllowed(command, args, disallowedSubcommands = DEFAULT_SAFETY.DISALLOWED_GIT_SUBCOMMANDS) {
  if (command !== "git") return;
  const subcommand = args[0];
  if (disallowedSubcommands.includes(subcommand)) {
    throw new CommandNotAllowedError(
      `git subcommand "${subcommand}" is not allowed in worktree-runner attempts (no automatic push/remote access).`
    );
  }
}
