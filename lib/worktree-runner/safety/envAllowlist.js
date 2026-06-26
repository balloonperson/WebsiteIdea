import { DEFAULT_SAFETY } from "../constants.js";

/**
 * Attempts never inherit the full host environment. Only explicitly
 * allowlisted variables are copied from sourceEnv, plus whatever extra
 * (already-vetted) entries the caller passes in extraEnv.
 */
export function buildAllowedEnv(sourceEnv, allowlist = DEFAULT_SAFETY.ENV_ALLOWLIST, extraEnv = {}) {
  const filtered = {};
  for (const key of allowlist) {
    if (sourceEnv[key] !== undefined) filtered[key] = sourceEnv[key];
  }
  return { ...filtered, ...extraEnv };
}
