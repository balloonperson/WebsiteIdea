import { KNOWLEDGE_STATUS } from "./constants.js";

// Forward-only state machine. A claim can be discarded (refuted) or aged
// out (stale) from any state, but nothing ever moves backwards from
// verified/refuted to a weaker status in place — a later re-confirmation
// is a *new* entry that supersedes the old one (superseded_by_entry_id),
// preserving the original entry as history.
const ALLOWED_TRANSITIONS = {
  [KNOWLEDGE_STATUS.CLAIMED]: [KNOWLEDGE_STATUS.PREDICTED, KNOWLEDGE_STATUS.VERIFIED, KNOWLEDGE_STATUS.REFUTED, KNOWLEDGE_STATUS.STALE],
  [KNOWLEDGE_STATUS.PREDICTED]: [KNOWLEDGE_STATUS.VERIFIED, KNOWLEDGE_STATUS.REFUTED, KNOWLEDGE_STATUS.STALE],
  [KNOWLEDGE_STATUS.VERIFIED]: [KNOWLEDGE_STATUS.REFUTED, KNOWLEDGE_STATUS.STALE],
  [KNOWLEDGE_STATUS.REFUTED]: [KNOWLEDGE_STATUS.STALE],
  [KNOWLEDGE_STATUS.STALE]: []
};

export function canTransition(fromStatus, toStatus) {
  return (ALLOWED_TRANSITIONS[fromStatus] ?? []).includes(toStatus);
}

const REQUIRED_FIELDS = ["repoCommitHash", "subjectScope", "taskFamily", "verificationMethod", "status"];

/**
 * Throws on any entry missing the provenance fields the plan requires, or
 * claiming "verified" without a source trace. A verified fact must trace
 * back to a real worktree execution — there is no way to verify something
 * by assertion alone.
 */
export function assertValidProvenance(entry) {
  for (const field of REQUIRED_FIELDS) {
    if (entry[field] == null || entry[field] === "") {
      throw new Error(`Knowledge entry missing required provenance field: ${field}`);
    }
  }
  if (entry.confidence == null || entry.confidence < 0 || entry.confidence > 1) {
    throw new Error("Knowledge entry confidence must be a number between 0 and 1.");
  }
  if (entry.status === KNOWLEDGE_STATUS.VERIFIED && !entry.sourceTraceId) {
    throw new Error("A verified knowledge entry must reference a source trace from a real worktree run.");
  }
}

/**
 * A verified or predicted fact only applies inside the exact scope it was
 * recorded in. Used before a generator consults knowledge for a new
 * candidate — narrower than a raw status check, since commit drift or a
 * mismatched task family silently disqualifies a fact even if its status
 * still says "verified".
 */
export function isApplicableToScope(entry, context) {
  if (entry.status !== KNOWLEDGE_STATUS.VERIFIED && entry.status !== KNOWLEDGE_STATUS.PREDICTED) return false;
  if (entry.repoCommitHash !== context.repoCommitHash) return false;
  if (entry.subjectScope !== context.subjectScope) return false;
  if (context.taskFamily && entry.taskFamily !== context.taskFamily) return false;
  return true;
}

export function isOutOfScope(entry, currentRepoCommitHash) {
  return (
    entry.repoCommitHash !== currentRepoCommitHash &&
    entry.status !== KNOWLEDGE_STATUS.STALE &&
    entry.status !== KNOWLEDGE_STATUS.REFUTED
  );
}
