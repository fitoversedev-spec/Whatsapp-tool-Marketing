// Structured output via a single FORCED tool. We deliberately avoid
// output_config / zod helpers (version-fragile across SDK releases); forcing a
// "respond" tool whose input_schema IS our JSON schema guarantees valid,
// typed JSON on any recent SDK. Used by the template-drafting feature.
import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, getAnthropic } from "./client";
import { AiError, mapAnthropicError } from "./errors";
import { assertWithinDailyCap, logAiUsage } from "./guardrails";

export type StructuredOptions = {
  feature: string;
  userId: string;
  system: string;
  user: string;
  // JSON Schema for the object to return (type: "object", properties, required).
  schema: Record<string, unknown>;
  // Prompt-cache the (large, stable) system block to cut cost on repeats.
  cacheSystem?: boolean;
  maxTokens?: number;
};

export async function generateStructured<T>(opts: StructuredOptions): Promise<T> {
  await assertWithinDailyCap(opts.userId);
  const client = getAnthropic();

  let res: Anthropic.Message;
  try {
    res = await client.messages.create({
      model: AI_MODEL,
      max_tokens: opts.maxTokens ?? 2000,
      // Deterministic drafting — no thinking needed; makes it faster + cheaper.
      thinking: { type: "disabled" },
      system: opts.cacheSystem
        ? [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }]
        : opts.system,
      tools: [
        {
          name: "respond",
          description: "Return the result in exactly the required structure.",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          input_schema: opts.schema as any,
        },
      ],
      tool_choice: { type: "tool", name: "respond" },
      messages: [{ role: "user", content: opts.user }],
    });
  } catch (e) {
    throw mapAnthropicError(e);
  }

  await logAiUsage({
    userId: opts.userId,
    feature: opts.feature,
    inputTokens: res.usage.input_tokens,
    outputTokens: res.usage.output_tokens,
  });

  const block = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "respond",
  );
  if (!block) throw new AiError("AI returned no structured result", "failed");
  return block.input as T;
}
