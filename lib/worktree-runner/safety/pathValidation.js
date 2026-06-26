import path from "node:path";

export class UnsafePathError extends Error {}

/**
 * Resolves targetPath and asserts it sits inside allowedRoot. Used to keep
 * every attempt workspace confined to the configured runs root — a
 * candidate solver's instructions cannot cause the runner to read or write
 * outside that boundary via "../" segments or absolute-path overrides.
 */
export function assertPathInsideRoot(targetPath, allowedRoot) {
  const resolvedRoot = path.resolve(allowedRoot);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative))) {
    throw new UnsafePathError(`Path "${targetPath}" escapes the allowed root "${allowedRoot}".`);
  }
  return resolvedTarget;
}

/**
 * The runner must never execute commands or destructive git operations
 * against the main working tree — only against isolated attempt
 * workspaces. This is the hard stop that backs that rule no matter which
 * call site forgets to check.
 */
export function assertNotMainWorkingTree(targetPath, mainWorkingTreePath) {
  const resolvedTarget = path.resolve(targetPath);
  const resolvedMain = path.resolve(mainWorkingTreePath);
  if (resolvedTarget === resolvedMain) {
    throw new UnsafePathError("Refusing to operate directly on the main working tree.");
  }
}
