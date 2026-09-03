/**
 * The Anthropic-backed theme extractor.
 *
 * Structured output via `messages.parse` and a Zod schema, so themes arrive
 * **typed** rather than parsed out of prose. The difference matters beyond
 * convenience: a schema is a boundary an injected instruction inside a review
 * cannot cross. The worst it can do is put a wrong value in a field that
 * already existed.
 *
 * Model id, parameters and the structured-output shape were taken from the
 * `claude-api` skill rather than from memory — both changed during 2025–26,
 * and `output_format` in particular is deprecated in favour of
 * `output_config.format`.
 *
 * ## What happens when it fails
 *
 * Nothing catastrophic, by design. A refusal, a rate limit, a malformed
 * response or a missing key all produce **no themes for that venue**, and
 * component 4 already treats missing themes as unmeasured rather than as a
 * finding. Extraction is an enrichment; the score exists without it.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
/**
 * `zod/v4`, not `zod`, and deliberately so.
 *
 * The rest of the codebase is on zod 3's classic API to match the host tool.
 * `@anthropic-ai/sdk/helpers/zod` is typed against `zod/v4` and will not accept
 * a v3 schema — the SDK's own peer range is `^3.25.0 || ^4.0.0` precisely
 * because zod 3.25 ships the v4 implementation under this subpath.
 *
 * So this one file — the only one that hands a schema to the SDK — uses the v4
 * surface. It requires **zod >= 3.25**; on an older 3.x the subpath does not
 * exist and this import fails to resolve. Nothing else imports from here, so
 * the v4 types do not leak: `parsed_output` is consumed as a plain object.
 */
import { z } from "zod/v4";

import { REVIEW_THEME_IDS } from "@/lib/scout/scoring";

import { SYSTEM_PROMPT, buildUserMessage, quoteIsVerbatim } from "./prompt";
import type {
  ExtractedTheme,
  ThemeExtractionJob,
  ThemeExtractionResult,
  ThemeExtractor,
} from "./types";

/**
 * Claude Opus 5. Overridable by environment so a model change is configuration
 * rather than a deploy, and so the extractor can be pointed at a cheaper model
 * if the client's volume ever makes that the right trade.
 */
export const DEFAULT_THEME_MODEL = "claude-opus-5";

/**
 * The output schema.
 *
 * `themes` is an array of a closed shape. There is no free-text field the
 * model can write a sentence into, and no field whose name a review could
 * introduce — which is the property that makes injected instructions inert
 * rather than merely unlikely to work.
 */
const themeSchema = z.object({
  themes: z.array(
    z.object({
      theme: z.enum(REVIEW_THEME_IDS),
      sentiment: z.enum(["negative", "neutral", "positive"]),
      mention_count: z.number().int().min(1).max(20),
      /** Copied character-for-character from one review. Verified after parsing. */
      quote: z.string().min(8).max(400),
    }),
  ),
});

export interface AnthropicExtractorOptions {
  readonly apiKey?: string;
  readonly model?: string;
  /** Injected in tests. Defaults to a real client built from the key. */
  readonly client?: Pick<Anthropic["messages"], "parse">;
  readonly maxTokens?: number;
}

/**
 * Merge duplicate (theme, sentiment) pairs the model may return separately,
 * keeping every verified quote.
 */
function collapse(
  entries: ReadonlyArray<{
    theme: (typeof REVIEW_THEME_IDS)[number];
    sentiment: "negative" | "neutral" | "positive";
    mention_count: number;
    quote: string;
  }>,
  job: ThemeExtractionJob,
): { themes: ExtractedTheme[]; rejected: number } {
  const byKey = new Map<string, { theme: ExtractedTheme; quotes: string[] }>();
  let rejected = 0;

  for (const entry of entries) {
    if (!quoteIsVerbatim(entry.quote, job.reviews)) {
      // A quote nobody wrote is either a hallucination or text an injected
      // instruction asked for. Either way it does not reach a report.
      rejected += 1;
      continue;
    }
    const key = `${entry.theme}:${entry.sentiment}`;
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.quotes.includes(entry.quote)) existing.quotes.push(entry.quote);
      existing.theme = {
        ...existing.theme,
        mentionCount: Math.max(existing.theme.mentionCount, entry.mention_count),
        quotes: existing.quotes,
      };
      continue;
    }
    const quotes = [entry.quote];
    byKey.set(key, {
      quotes,
      theme: {
        theme: entry.theme,
        sentiment: entry.sentiment,
        mentionCount: entry.mention_count,
        quotes,
      },
    });
  }

  return {
    themes: [...byKey.values()]
      .map((v) => v.theme)
      .sort((a, b) => a.theme.localeCompare(b.theme) || a.sentiment.localeCompare(b.sentiment)),
    rejected,
  };
}

export function createAnthropicExtractor(
  options: AnthropicExtractorOptions = {},
): ThemeExtractor {
  const model = options.model ?? process.env.ANTHROPIC_THEME_MODEL ?? DEFAULT_THEME_MODEL;
  const maxTokens = options.maxTokens ?? 2048;

  const messages =
    options.client ??
    new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {}).messages;

  return {
    modelVersion: model,
    async extract(job: ThemeExtractionJob): Promise<ThemeExtractionResult> {
      const empty: ThemeExtractionResult = {
        placeInternalId: job.placeInternalId,
        googlePlaceId: job.googlePlaceId,
        reviewHash: job.reviewHash,
        themes: [],
        modelVersion: model,
        rejectedThemes: 0,
      };
      if (job.reviews.length === 0) return empty;

      const response = await messages.parse({
        model,
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT,
        // Low effort: this is classification of five short paragraphs, not
        // reasoning. Thinking stays on (the default on Opus 5) — the effort
        // dial is what keeps the cost proportionate to the task.
        output_config: { effort: "low", format: zodOutputFormat(themeSchema) },
        messages: [{ role: "user", content: buildUserMessage(job) }],
      });

      /**
       * A refusal is a legitimate outcome, not an exception. Reviews can
       * contain anything; if a classifier declines one venue's text, that
       * venue simply has no themes and component 4 says so.
       */
      if (response.stop_reason === "refusal") return empty;

      const parsed = response.parsed_output;
      if (!parsed) return empty;

      const { themes, rejected } = collapse(parsed.themes, job);
      return { ...empty, themes, rejectedThemes: rejected };
    },
  };
}
