import Anthropic from "@anthropic-ai/sdk";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

export async function callAi({ system, user }) {
  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY.includes("your_")) {
    const error = new Error("Missing Anthropic API key. Add ANTHROPIC_API_KEY to your .env file.");
    error.statusCode = 400;
    throw error;
  }

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  });

  const response = await client.messages.create({
    model: process.env.AI_MODEL || DEFAULT_MODEL,
    max_tokens: 8192,
    temperature: 0.2,
    system,
    messages: [
      {
        role: "user",
        content: user
      }
    ]
  });

  return response.content
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

export function parseJsonResponse(rawText, requiredKey) {
  const cleaned = rawText
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (requiredKey && !parsed[requiredKey]) {
      throw new Error(`AI response was missing "${requiredKey}".`);
    }
    return parsed;
  } catch (error) {
    if (requiredKey === "instructions") {
      const match = cleaned.match(/"instructions"\s*:\s*"((?:\\.|[^"\\])*)"/s);
      if (match?.[1]) {
        return {
          subjectSummary: "",
          relevantAreas: [],
          solverAnalysis: [],
          instructions: JSON.parse(`"${match[1]}"`)
        };
      }
    }

    const parseError = new Error(`Could not parse AI response as JSON: ${error.message}`);
    parseError.statusCode = 502;
    parseError.rawResponse = rawText;
    throw parseError;
  }
}
