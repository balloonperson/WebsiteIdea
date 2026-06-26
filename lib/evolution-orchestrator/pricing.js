// Static USD-per-million-token rates for cost estimation. Approximate
// published list prices; only used to turn token counts into a comparable
// dollar figure for charts, not for billing.
const RATES_PER_MILLION = [
  { match: /opus/i, inputUsd: 15, outputUsd: 75 },
  { match: /sonnet/i, inputUsd: 3, outputUsd: 15 },
  { match: /haiku/i, inputUsd: 0.8, outputUsd: 4 }
];

const DEFAULT_RATE = { inputUsd: 3, outputUsd: 15 };

export function estimateCostUsd({ model, inputTokens = 0, outputTokens = 0 }) {
  const rate = RATES_PER_MILLION.find((entry) => entry.match.test(model || "")) || DEFAULT_RATE;
  return (inputTokens / 1_000_000) * rate.inputUsd + (outputTokens / 1_000_000) * rate.outputUsd;
}
