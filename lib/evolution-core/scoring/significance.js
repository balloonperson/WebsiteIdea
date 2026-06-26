// This is the module that keeps the engine honest about "predicted" vs
// "verified": a mean improvement is not promoted on its own. It must clear
// an effect-size bar against the incumbent it would replace, computed from
// the same noise samples (mean/variance/n) every evaluation already stores.
import { DEFAULTS } from "../constants.js";

export function pooledStdDev(a, b) {
  const dfA = a.n - 1;
  const dfB = b.n - 1;
  const df = dfA + dfB;
  if (df <= 0) return null;
  return Math.sqrt((dfA * a.variance + dfB * b.variance) / df);
}

export function cohensD(a, b) {
  const pooled = pooledStdDev(a, b);
  if (pooled === null || pooled === 0) return null;
  return (a.mean - b.mean) / pooled;
}

/**
 * @param {{mean:number, variance:number, n:number}} candidate
 * @param {{mean:number, variance:number, n:number}} baseline
 */
export function evaluateSignificance(
  candidate,
  baseline,
  { minEffectSize = DEFAULTS.MIN_EFFECT_SIZE, minSampleSize = DEFAULTS.MIN_SAMPLE_SIZE } = {}
) {
  if (candidate.n < minSampleSize || baseline.n < minSampleSize) {
    return { significant: false, reason: "insufficient-sample", effectSize: null };
  }

  const effectSize = cohensD(candidate, baseline);

  if (effectSize === null) {
    // Zero pooled variance: both sides were perfectly consistent. Fall back
    // to a plain mean comparison since Cohen's d is undefined at zero
    // variance, not because there's no detectable difference.
    const significant = candidate.mean > baseline.mean;
    return { significant, reason: significant ? "zero-variance-mean-improved" : "zero-variance-no-improvement", effectSize: null };
  }

  const significant = effectSize >= minEffectSize && candidate.mean > baseline.mean;
  return {
    significant,
    reason: significant ? "effect-size-met" : "effect-size-below-threshold",
    effectSize
  };
}
