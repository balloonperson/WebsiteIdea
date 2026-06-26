import { callAiWithUsage } from "../ai.js";
import { estimateCostUsd } from "./pricing.js";
import { parseJsonLoose } from "./aiCandidate.js";

/**
 * Simulated Eval mode: ask the model to predict how a coding agent
 * following `instructions` would perform on `task`, WITHOUT executing any
 * code. This is fast and unverified by construction — it can only ever
 * back a Predicted Leader, never a Verified Leader. Real worktree
 * execution (Branch 3) is what would produce a verified trace; until that
 * is wired in, every trace this module produces is tagged runnerMode
 * "simulated".
 */
export async function runSimulatedTrial({ instructions, task, subject }) {
  const system = [
    "You are simulating, not executing, a coding agent's attempt at a task.",
    "You do not have access to a real sandbox or the actual code. Predict a plausible outcome only.",
    "Be honest about uncertainty: a vague or generic instruction set should not score as confidently as a specific one.",
    "Return JSON only, no markdown fences."
  ].join(" ");

  const user = [
    `Subject scope: ${subject}`,
    "",
    "Candidate instructions given to the coding agent:",
    instructions,
    "",
    "Task the agent must solve:",
    task.prompt,
    "",
    `Expected criteria: ${JSON.stringify(task.expectedCriteria || [])}`,
    "",
    'Respond with JSON: {"score": 0..1, "passed": true|false, "criticalFailure": true|false, ' +
      '"estimatedTokensIn": number, "estimatedTokensOut": number, "reasoning": "..."}'
  ].join("\n");

  const { text, model, usage } = await callAiWithUsage({ system, user });
  const parsed = parseJsonLoose(text);

  if (!parsed || typeof parsed.score !== "number") {
    return {
      score: 0,
      passed: false,
      criticalFailure: true,
      tokensIn: usage.inputTokens,
      tokensOut: usage.outputTokens,
      costUsd: estimateCostUsd({ model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }),
      reasoning: "Judge response could not be parsed; treated as a failed trial."
    };
  }

  const score = Math.max(0, Math.min(1, parsed.score));
  return {
    score,
    passed: Boolean(parsed.passed),
    criticalFailure: Boolean(parsed.criticalFailure),
    tokensIn: Number(parsed.estimatedTokensIn) || usage.inputTokens,
    tokensOut: Number(parsed.estimatedTokensOut) || usage.outputTokens,
    costUsd: estimateCostUsd({ model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }),
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : ""
  };
}

export async function runNoiseTrials({ instructions, task, subject, repeatCount }) {
  const traces = [];
  for (let i = 0; i < repeatCount; i += 1) {
    traces.push(await runSimulatedTrial({ instructions, task, subject }));
  }
  return traces;
}
