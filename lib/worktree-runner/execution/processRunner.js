import { spawn } from "node:child_process";
import { assertArgsAreSafe, assertCommandAllowed, assertGitSubcommandAllowed } from "../safety/commandAllowlist.js";
import { DEFAULT_SAFETY } from "../constants.js";

/**
 * Runs a single command step inside an isolated workspace with hard safety
 * rails: allowlisted command/subcommand, args as an array (never a shell
 * string), a wall-clock timeout, and an output-size cap. The promise never
 * rejects on attempt failure — timeouts, oversized output, and non-zero
 * exit codes are all reported as data so callers can build a verification
 * result instead of catching exceptions for expected outcomes.
 */
export function runProcess({
  command,
  args = [],
  cwd,
  env = {},
  allowlist = DEFAULT_SAFETY.COMMAND_ALLOWLIST,
  disallowedGitSubcommands = DEFAULT_SAFETY.DISALLOWED_GIT_SUBCOMMANDS,
  timeoutMs = DEFAULT_SAFETY.TIMEOUT_MS,
  maxOutputBytes = DEFAULT_SAFETY.MAX_OUTPUT_BYTES
}) {
  assertArgsAreSafe(args);
  assertCommandAllowed(command, allowlist);
  assertGitSubcommandAllowed(command, args, disallowedGitSubcommands);

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, { cwd, env, shell: false });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let outputTruncated = false;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    function onChunk(chunk, currentBytes, append) {
      const nextBytes = currentBytes + chunk.length;
      if (nextBytes > maxOutputBytes) {
        outputTruncated = true;
        child.kill("SIGKILL");
        return nextBytes;
      }
      append(chunk.toString("utf8"));
      return nextBytes;
    }

    child.stdout.on("data", (chunk) => {
      stdoutBytes = onChunk(chunk, stdoutBytes, (text) => (stdout += text));
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes = onChunk(chunk, stderrBytes, (text) => (stderr += text));
    });

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        timedOut,
        outputTruncated,
        elapsedMs: Date.now() - startedAt,
        spawnError: null,
        ...result
      });
    }

    child.on("error", (err) => {
      finish({ exitCode: null, signal: null, spawnError: err.message });
    });

    child.on("close", (exitCode, signal) => {
      finish({ exitCode, signal });
    });
  });
}
