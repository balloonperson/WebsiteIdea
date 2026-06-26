/**
 * Stage 4: quality ordering. Mode-agnostic ranking by correctness signal —
 * used to pick the best challenger among several candidates evaluated in
 * the same cycle before testing it against the incumbent champion.
 */
export function rankByQuality(evaluations) {
  return [...evaluations].sort((a, b) => {
    if (b.meanScore !== a.meanScore) return b.meanScore - a.meanScore;
    if (b.passRate !== a.passRate) return b.passRate - a.passRate;
    return a.variance - b.variance;
  });
}
