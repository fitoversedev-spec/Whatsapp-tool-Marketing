// Manual tool-use loop. The model is given a set of tools it can call; we
// execute the matching handler server-side and feed the real result back,
// looping until it produces a final text answer. Used by the analytics
// feature so numbers only ever come from real DB queries (never invented).
import Anthropic from "@anthropic-ai/sdk";
import { AI_MODEL, getAnthropic } from "./client";
import { AI_MAX_TOKENS_DEFAULT, assertWithinDailyCap, logAiUsage } from "./guardrails";
import { mapAnthropicError } from "./errors";

export type AiTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  // Runs server-side with the model-supplied input; returns real data.
  handler: (input: any) => Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export type ToolLoopOptions = {
  feature: string;
  userId: string;
  system: string;
  user: string;
  tools: AiTool[];
  cacheSystem?: boolean;
  maxRounds?: number;
  maxTokens?: number;
};

export type ToolLoopResult = {
  text: string;
  toolResults: Array<{ name: string; input: any; output: unknown }>; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export async function runToolLoop(opts: ToolLoopOptions): Promise<ToolLoopResult> {
  await assertWithinDailyCap(opts.userId);
  const client = getAnthropic();
  const maxRounds = opts.maxRounds ?? 6;
  const maxTokens = opts.maxTokens ?? AI_MAX_TOKENS_DEFAULT;

  const system = opts.cacheSystem
    ? [{ type: "text" as const, text: opts.system, cache_control: { type: "ephemeral" as const } }]
    : opts.system;

  const toolDefs = opts.tools.map((t) => ({
    name: t.name,
    description: t.description,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input_schema: t.input_schema as any,
  }));
  const byName = new Map(opts.tools.map((t) => [t.name, t] as const));

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.user }];
  const toolResults: ToolLoopResult["toolResults"] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (let round = 0; round < maxRounds; round++) {
    // On the final round drop the tools so the model must produce prose.
    const lastRound = round === maxRounds - 1;
    let res: Anthropic.Message;
    try {
      res = await client.messages.create({
        model: AI_MODEL,
        max_tokens: maxTokens,
        system,
        messages,
        ...(lastRound ? {} : { tools: toolDefs }),
      });
    } catch (e) {
      throw mapAnthropicError(e);
    }
    inputTokens += res.usage.input_tokens;
    outputTokens += res.usage.output_tokens;

    if (res.stop_reason !== "tool_use") {
      await logAiUsage({ userId: opts.userId, feature: opts.feature, inputTokens, outputTokens });
      return { text: extractText(res.content), toolResults };
    }

    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type === "tool_use") {
        const tool = byName.get(block.name);
        let output: unknown;
        try {
          output = tool
            ? await tool.handler(block.input)
            : { error: `unknown tool: ${block.name}` };
        } catch (e) {
          output = { error: e instanceof Error ? e.message : String(e) };
        }
        toolResults.push({ name: block.name, input: block.input, output });
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(output),
        });
      }
    }
    messages.push({ role: "user", content: results });
  }

  await logAiUsage({ userId: opts.userId, feature: opts.feature, inputTokens, outputTokens });
  return { text: "", toolResults };
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
