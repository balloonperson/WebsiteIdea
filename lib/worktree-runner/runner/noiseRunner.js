import { runAttempt } from "./runAttempt.js";

/**
 * Runs the same command profile repeatCount times (3 by default elsewhere
 * in the system) through a concurrency limiter, so noise trials for one
 * candidate/task pair don't blow past the configured concurrency cap on
 * their own. Returns attempts in repeat order regardless of completion
 * order.
 */
export async function runNoiseRepeats({ profile, pool, limiter, repeatCount, safety = {}, costMetadataFn = null }) {
  const attempts = await Promise.all(
    Array.from({ length: repeatCount }, (_, repeatIndex) =>
      limiter.run(() => runAttempt({ profile, pool, safety, costMetadataFn, attemptId: `${profile.id}-${repeatIndex}` }))
    )
  );
  return attempts;
}
