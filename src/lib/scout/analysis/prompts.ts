import type { PlaceContext, AreaSummaryResult, PlaceInsightResult } from "./types";

export const SEARCH_SYSTEM_PROMPT = `You are a sports facility market researcher for Fitoverse, an Indian sports infrastructure company. You are analysing competitor and nearby facilities to help decide where to build new sports facilities.

For each place you are given, search the web for:
1. **Establishment date** — when the facility was founded/opened. Look for "About" pages, press releases, or business registries.
2. **Popular times** — peak hours and busy days. Check Google Maps data or social media posts about peak hours.
3. **Google Reviews — deep dive** — go beyond overall sentiment. Read individual reviews to identify:
   - **What works** — specific things customers praise (e.g. "well-maintained turf", "good floodlights", "convenient parking", "friendly staff")
   - **What doesn't work** — specific complaints and pain points (e.g. "poor drainage", "overcrowded evenings", "no drinking water", "rude management")
   - Look for at least 5-10 specific positive and negative points from reviews.
4. **Social media presence** — check for mentions on Instagram, Facebook, Twitter/X, or local sports forums.
5. **Facility suitability** — is the area suitable for building another sports facility? Consider foot traffic, demographics, and competition density.

Rules:
- ONLY report data you find from web sources. If you cannot find information, report it as "Not Available".
- Never fabricate or guess data. "Not Available" with Low confidence is always better than a hallucination.
- Include the source URL for every claim.
- Search using the place name combined with the city/area for best results.
- For reviews, be thorough — search for the place on Google Maps, read multiple reviews, and extract concrete specifics, not vague generalisations.`;

const PRICE_LABELS: Record<number, string> = {
  0: "Free",
  1: "Inexpensive",
  2: "Moderate",
  3: "Expensive",
  4: "Very Expensive",
};

function formatOperatingWindow(ow: Record<string, unknown> | null): string | null {
  if (!ow) return null;
  const periods = ow.periods as Array<{ open?: { day?: number; hour?: number; minute?: number }; close?: { day?: number; hour?: number; minute?: number } }> | undefined;
  if (!Array.isArray(periods) || periods.length === 0) return null;

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const lines: string[] = [];
  for (const p of periods) {
    const openDay = p.open?.day ?? 0;
    const openH = p.open?.hour ?? 0;
    const openM = p.open?.minute ?? 0;
    const closeH = p.close?.hour ?? 0;
    const closeM = p.close?.minute ?? 0;
    const fmt = (h: number, m: number) => `${h}:${String(m).padStart(2, "0")}`;
    lines.push(`${dayNames[openDay]}: ${fmt(openH, openM)}–${fmt(closeH, closeM)}`);
  }
  return lines.join(", ");
}

export function buildSearchPrompt(place: PlaceContext): string {
  const parts = [
    `Analyse this facility:`,
    `Name: ${place.name}`,
  ];
  if (place.address) parts.push(`Address: ${place.address}`);
  if (place.googleMapsUri) parts.push(`Google Maps: ${place.googleMapsUri}`);
  if (place.primaryType) {
    const display = place.primaryTypeDisplayName && place.primaryTypeDisplayName !== place.primaryType
      ? `${place.primaryTypeDisplayName} (${place.primaryType})`
      : place.primaryType;
    parts.push(`Type: ${display}`);
  }
  if (place.rating != null) parts.push(`Rating: ${place.rating}/5 (${place.reviewCount ?? 0} reviews)`);
  if (place.priceLevel != null) parts.push(`Price level: ${PRICE_LABELS[place.priceLevel] ?? `Level ${place.priceLevel}`}`);
  if (place.websiteUri) parts.push(`Website: ${place.websiteUri}`);
  if (place.phone) parts.push(`Phone: ${place.phone}`);
  if (place.businessStatus && place.businessStatus !== "OPERATIONAL") {
    parts.push(`Business status: ${place.businessStatus} (NOT currently operational)`);
  }
  if (place.googleTypes.length > 0) {
    parts.push(`Google categories: ${place.googleTypes.join(", ")}`);
  }

  const hoursStr = formatOperatingWindow(place.operatingWindow);
  if (hoursStr) parts.push(`Operating hours: ${hoursStr}`);

  if (place.reviewThemes.length > 0) {
    parts.push("", "Existing review theme analysis (from Google Reviews):");
    for (const t of place.reviewThemes) {
      parts.push(`  - ${t.theme}: ${t.sentiment} (${t.mentionCount} mentions)`);
    }
  }

  parts.push(
    "",
    "The data above is verified from Google Places — do NOT re-search for these facts.",
    "Focus your web search on what is NOT provided above: establishment date, popular times, Google Reviews (read individual reviews to find specific things that work well and specific complaints), social media mentions, and whether this area is suitable for a new sports facility.",
    "Focus especially on extracting concrete 'what works' and 'what doesn't work' from customer reviews.",
  );
  return parts.join("\n");
}

export const EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    establishedDate: {
      type: "object",
      properties: {
        value: { type: ["string", "null"], description: "The date or year the facility was established, or null if not found." },
        confidence: { type: "string", enum: ["High", "Medium", "Low"] },
        source: { type: ["string", "null"], description: "URL where this was found." },
      },
      required: ["value", "confidence", "source"],
    },
    popularTimes: {
      type: "object",
      properties: {
        value: { type: ["string", "null"], description: "Description of peak hours/days, or null if not found." },
        confidence: { type: "string", enum: ["High", "Medium", "Low"] },
        source: { type: ["string", "null"] },
      },
      required: ["value", "confidence", "source"],
    },
    sentiment: {
      type: "object",
      properties: {
        googleReviews: {
          type: "object",
          properties: {
            summary: { type: "string", description: "2-3 sentence summary of review sentiment." },
            tone: { type: "string", enum: ["Positive", "Mixed", "Negative", "Insufficient data"] },
            confidence: { type: "string", enum: ["High", "Medium", "Low"] },
          },
          required: ["summary", "tone", "confidence"],
        },
        socialMedia: {
          type: "object",
          properties: {
            summary: { type: ["string", "null"], description: "Social media sentiment summary, or null if not found." },
            confidence: { type: "string", enum: ["High", "Medium", "Low"] },
            source: { type: ["string", "null"] },
          },
          required: ["summary", "confidence", "source"],
        },
        whatWorks: {
          type: "array",
          items: { type: "string" },
          description: "Specific things customers praise in reviews — be concrete (e.g. 'Well-maintained artificial turf', 'Good floodlights for night play', 'Ample parking space'). Extract 3-8 items.",
        },
        whatDoesnt: {
          type: "array",
          items: { type: "string" },
          description: "Specific complaints from reviews — be concrete (e.g. 'Poor drainage during rain', 'No drinking water facility', 'Overcrowded on weekends'). Extract 3-8 items.",
        },
      },
      required: ["googleReviews", "socialMedia", "whatWorks", "whatDoesnt"],
    },
    suitability: {
      type: "object",
      properties: {
        recommendation: { type: "string", description: "One-sentence recommendation on suitability for a new facility." },
        confidence: { type: "string", enum: ["High", "Medium", "Low"] },
        reasoning: { type: "string", description: "2-3 sentences explaining the reasoning." },
      },
      required: ["recommendation", "confidence", "reasoning"],
    },
    citations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          url: { type: "string" },
          title: { type: "string" },
        },
        required: ["url", "title"],
      },
      description: "All web sources referenced.",
    },
  },
  required: ["establishedDate", "popularTimes", "sentiment", "suitability", "citations"],
};

export const EXTRACTION_SYSTEM = `You are extracting structured data from web search results about a sports facility. Extract only verified facts with source URLs. For anything you cannot verify, use null for the value and "Low" for confidence. Never fabricate data.`;

export const AREA_SUMMARY_SYSTEM = `You are a senior sports facility consultant for Fitoverse, India's leading sports infrastructure company. Given AI analysis results for multiple facilities in an area, synthesise a comprehensive market assessment and go-to-market strategy.

Your output must be data-driven and immediately actionable for the sales team. For each section:
- **Market assessment**: Cite specific competitor names, ratings, and review patterns.
- **Competitor learnings**: Extract 3-5 concrete lessons from competitor complaints — each one becomes a rule our new facility must follow.
- **Opportunities**: List 3-5 specific market gaps the data reveals (e.g. "No facility offers night-time slots after 10 PM despite demand seen in reviews").
- **Promotion plan**: Provide a practical 3-6 month marketing plan with specific channels and actions.
- **Launch checklist**: A prioritised pre-launch action list.
- **One-line strategy**: A single sentence the salesperson can use to pitch the opportunity.

Be specific about what the data shows — do not make generic statements like "consider marketing". Instead say "Run Instagram reels targeting 18-25 year old football players within 5 km, leveraging the gap in evening slots."`;


export function buildAreaSummaryPrompt(
  areaLabel: string,
  radiusM: number,
  insights: ReadonlyArray<{ name: string; insight: PlaceInsightResult }>,
): string {
  const parts = [
    `Area: ${areaLabel} (${(radiusM / 1000).toFixed(1)} km radius)`,
    `Facilities analysed: ${insights.length}`,
    "",
  ];

  for (const { name, insight } of insights) {
    parts.push(`--- ${name} ---`);
    parts.push(`Established: ${insight.establishedDate.value ?? "Not Available"} (${insight.establishedDate.confidence})`);
    parts.push(`Popular times: ${insight.popularTimes.value ?? "Not Available"}`);
    parts.push(`Google Reviews: ${insight.sentiment.googleReviews.tone} — ${insight.sentiment.googleReviews.summary}`);
    if (insight.sentiment.whatWorks?.length) {
      parts.push(`What works well: ${insight.sentiment.whatWorks.join("; ")}`);
    }
    if (insight.sentiment.whatDoesnt?.length) {
      parts.push(`What doesn't work: ${insight.sentiment.whatDoesnt.join("; ")}`);
    }
    if (insight.sentiment.socialMedia.summary) {
      parts.push(`Social media: ${insight.sentiment.socialMedia.summary}`);
    }
    parts.push(`Suitability: ${insight.suitability.recommendation}`);
    parts.push("");
  }

  parts.push(
    "Based on the above data:",
    "1. Provide an overall market assessment.",
    "2. Extract 3-5 competitor learnings — specific complaints at competitors that our facility MUST avoid. For each, name the complaint, where it was seen, and the rule we should follow.",
    "3. List 3-5 specific opportunities/gaps in this market that the data reveals.",
    "4. Create a practical 3-6 month promotion plan with specific channels and actions.",
    "5. Build a prioritised pre-launch checklist.",
    "6. Write one punchy strategy sentence a salesperson can use to pitch this opportunity.",
  );
  return parts.join("\n");
}

export const AREA_SUMMARY_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    marketSaturation: {
      type: "object",
      properties: {
        level: { type: "string", enum: ["Low", "Moderate", "High", "Oversaturated"] },
        explanation: { type: "string", description: "2-3 sentences explaining the saturation level based on the data." },
      },
      required: ["level", "explanation"],
    },
    opportunityScore: {
      type: "object",
      properties: {
        score: { type: "number", minimum: 1, maximum: 10, description: "1-10 opportunity score." },
        reasoning: { type: "string", description: "2-3 sentences explaining the score." },
      },
      required: ["score", "reasoning"],
    },
    risks: {
      type: "array",
      items: { type: "string" },
      description: "List of specific risks identified from the data (2-5 items).",
    },
    executiveRecommendation: {
      type: "string",
      description: "3-4 sentence executive recommendation for the sales team.",
    },
    competitorLearnings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          complaint: { type: "string", description: "The specific complaint pattern (e.g. 'Poor drainage causes waterlogging during monsoon')." },
          seenAt: { type: "string", description: "Which competitor(s) this was seen at." },
          ourRule: { type: "string", description: "The rule our facility must follow (e.g. 'Install sub-surface drainage system rated for heavy monsoon rain')." },
        },
        required: ["complaint", "seenAt", "ourRule"],
      },
      description: "3-5 concrete lessons from competitor complaints that become rules for our facility.",
    },
    opportunities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short title (e.g. 'Late-night slots gap')." },
          detail: { type: "string", description: "1-2 sentences explaining the opportunity with data backing." },
        },
        required: ["title", "detail"],
      },
      description: "3-5 specific market gaps the data reveals.",
    },
    promotionPlan: {
      type: "array",
      items: {
        type: "object",
        properties: {
          channel: { type: "string", description: "Marketing channel (e.g. 'Instagram Reels', 'Local school partnerships', 'Google My Business')." },
          action: { type: "string", description: "Specific action to take." },
          timeline: { type: "string", description: "When to do this (e.g. 'Month 1-2', 'Pre-launch', 'Ongoing')." },
        },
        required: ["channel", "action", "timeline"],
      },
      description: "Practical 3-6 month promotion plan with specific channels and actions.",
    },
    launchChecklist: {
      type: "array",
      items: {
        type: "object",
        properties: {
          task: { type: "string", description: "The action item." },
          priority: { type: "string", enum: ["High", "Medium", "Low"] },
          when: { type: "string", description: "Timeline (e.g. 'Before launch', 'Week 1', 'Month 1-3')." },
        },
        required: ["task", "priority", "when"],
      },
      description: "Prioritised pre-launch and early-operation checklist (5-10 items).",
    },
    oneLineStrategy: {
      type: "string",
      description: "One punchy sentence a salesperson can use to pitch this opportunity to a client.",
    },
  },
  required: [
    "marketSaturation", "opportunityScore", "risks", "executiveRecommendation",
    "competitorLearnings", "opportunities", "promotionPlan", "launchChecklist", "oneLineStrategy",
  ],
};
