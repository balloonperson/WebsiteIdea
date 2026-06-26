// Named presets for the Settings > Basic > Objective control. "Custom"
// just means the operator's own values pass through untouched.
export const OBJECTIVE_PROFILES = {
  quality: {
    label: "Quality",
    correctnessThreshold: 0.9,
    minEffectSize: 0.5,
    candidatesPerCycle: 3,
    balancedScoreOptions: { correctnessWeight: 0.8, costWeight: 0.1, tokenWeight: 0.1 }
  },
  "cost-efficient": {
    label: "Cost Efficient",
    correctnessThreshold: 0.75,
    minEffectSize: 0.4,
    candidatesPerCycle: 2,
    balancedScoreOptions: { correctnessWeight: 0.4, costWeight: 0.4, tokenWeight: 0.2 }
  },
  balanced: {
    label: "Balanced",
    correctnessThreshold: 0.8,
    minEffectSize: 0.5,
    candidatesPerCycle: 2,
    balancedScoreOptions: { correctnessWeight: 0.6, costWeight: 0.25, tokenWeight: 0.15 }
  },
  custom: {
    label: "Custom",
    correctnessThreshold: 0.8,
    minEffectSize: 0.5,
    candidatesPerCycle: 2,
    balancedScoreOptions: { correctnessWeight: 0.6, costWeight: 0.25, tokenWeight: 0.15 }
  }
};

export function resolveObjectiveProfile(name) {
  return OBJECTIVE_PROFILES[name] || OBJECTIVE_PROFILES.custom;
}
