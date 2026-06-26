const DEFAULT_MAX_PER_BUCKET = 3;

function signature(task) {
  return [
    task.taskFamily ?? "",
    task.fileScope ?? "single",
    task.difficulty ?? "medium",
    task.failureMode ?? ""
  ].join("::");
}

function fileSetOverlap(a, b) {
  const setA = new Set((a.expectedTouchedAreas ?? []).map((p) => p.trim().toLowerCase()));
  const setB = new Set((b.expectedTouchedAreas ?? []).map((p) => p.trim().toLowerCase()));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const item of setA) if (setB.has(item)) shared += 1;
  return shared / Math.min(setA.size, setB.size);
}

/**
 * Walks candidate tasks in order and rejects ones that pile onto a
 * (family, file-scope, difficulty, failure-mode) bucket already at quota, or
 * that touch nearly the same files as a task already accepted in this batch.
 * `existingTasks` seeds bucket counts so diversity is judged against the
 * whole task set, not just the new batch.
 */
export function enforceDiversity(existingTasks, candidateTasks, { maxPerBucket = DEFAULT_MAX_PER_BUCKET, fileOverlapThreshold = 0.8 } = {}) {
  const bucketCounts = new Map();
  for (const task of existingTasks) {
    const sig = signature(task);
    bucketCounts.set(sig, (bucketCounts.get(sig) ?? 0) + 1);
  }

  const accepted = [];
  const rejected = [];
  const acceptedSoFar = [...existingTasks];

  for (const task of candidateTasks) {
    const sig = signature(task);
    const count = bucketCounts.get(sig) ?? 0;

    if (count >= maxPerBucket) {
      rejected.push({ task, reason: `Bucket "${sig}" is already at the diversity cap (${maxPerBucket}).` });
      continue;
    }

    const nearDuplicate = acceptedSoFar.find((other) => fileSetOverlap(task, other) >= fileOverlapThreshold);
    if (nearDuplicate) {
      rejected.push({ task, reason: `Touches nearly the same files as an existing task (id ${nearDuplicate.id ?? "n/a"}).` });
      continue;
    }

    bucketCounts.set(sig, count + 1);
    acceptedSoFar.push(task);
    accepted.push(task);
  }

  return { accepted, rejected };
}
