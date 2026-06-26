// Default noise handling: every candidate/task pairing is run N times (3 by
// default) and reduced to a single aggregate. This is the only place that
// reduction happens, so every champion-slot and gate decision downstream
// sees the same definitions of mean/min/variance/etc.

export function average(values) {
  return sum(values) / values.length;
}

export function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

export function sampleVariance(values, mean) {
  if (values.length < 2) return 0;
  const squaredDiffs = values.reduce((total, value) => total + (value - mean) ** 2, 0);
  return squaredDiffs / (values.length - 1);
}

// Generic reducer used both for the stored aggregate columns and for
// on-demand sampling (e.g. balanced-score significance testing) computed
// straight from persisted eval_traces.
export function aggregateMetric(traces, extractor) {
  const values = traces.map(extractor);
  const mean = average(values);
  return {
    mean,
    min: Math.min(...values),
    variance: sampleVariance(values, mean),
    n: values.length
  };
}

export function aggregateNoiseRepeats(traces) {
  if (!traces || traces.length === 0) {
    throw new Error("Cannot aggregate an empty set of eval traces.");
  }

  const scoreStats = aggregateMetric(traces, (t) => t.score);
  const costStats = aggregateMetric(traces, (t) => t.costUsd);
  const tokensIn = traces.map((t) => t.tokensIn);
  const tokensOut = traces.map((t) => t.tokensOut);
  const passCount = traces.filter((t) => t.passed).length;
  const criticalFailureCount = traces.filter((t) => t.criticalFailure).length;

  return {
    repeatCount: traces.length,
    meanScore: scoreStats.mean,
    minScore: scoreStats.min,
    variance: scoreStats.variance,
    passRate: passCount / traces.length,
    criticalFailureRate: criticalFailureCount / traces.length,
    meanTokensIn: average(tokensIn),
    meanTokensOut: average(tokensOut),
    meanCostUsd: costStats.mean,
    costVariance: costStats.variance,
    totalTokensIn: sum(tokensIn),
    totalTokensOut: sum(tokensOut),
    totalCostUsd: sum(traces.map((t) => t.costUsd))
  };
}
