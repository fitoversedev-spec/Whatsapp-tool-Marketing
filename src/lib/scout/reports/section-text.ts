import type { ReportDocument, AiSummarySection, SuggestionsSection, LimitationsSection } from "./types";

/**
 * Extract a human-readable text representation for each report block
 * from an assembled `ReportDocument`. Used by the section editor so
 * the user can see — and edit — what each section would say in the PDF.
 */
export function sectionTextFromDocument(
  doc: ReportDocument,
): Record<string, string> {
  const out: Record<string, string> = {};

  // header
  const m = doc.meta;
  out["header"] = [
    `Area: ${m.areaLabel}`,
    m.address ? `Address: ${m.address}` : null,
    m.customerName ? `Customer: ${m.customerName}` : null,
    `Radius: ${m.radiusLabel}`,
    m.dataCollectedAtLabel ? `Data collected: ${m.dataCollectedAtLabel}` : null,
    `Prepared by: ${m.preparedBy}`,
  ]
    .filter(Boolean)
    .join("\n");

  // stat-cards
  if (doc.cover.stats) {
    out["stat-cards"] = doc.cover.stats
      .map((s) => `${s.label}: ${s.value}`)
      .join("\n");
  }

  // score
  if (doc.verdict) {
    const v = doc.verdict;
    const lines = [
      `${v.verdictLabel} — ${v.total} ${v.outOf}`,
      v.statement,
      "",
      "Components:",
      ...v.components.map(
        (c) => `• ${c.label}: ${c.points}${c.justification ? ` — ${c.justification}` : ""}`,
      ),
    ];
    if (v.hardFlags.length > 0) {
      lines.push("", "Flags:", ...v.hardFlags.map((f) => `• ${f.message}`));
    }
    out["score"] = lines.join("\n");
  }

  // saturation
  if (doc.catchment.saturation) {
    const s = doc.catchment.saturation;
    out["saturation"] = [
      s.figure,
      s.benchmark,
      s.standing,
      "",
      s.methodNote,
    ]
      .filter(Boolean)
      .join("\n");
  }

  // count-table
  if (doc.demand.countTable) {
    const rows = doc.demand.countTable;
    const header = "Category | Side | Count | Reviews | Nearest";
    const divider = "---|---|---|---|---";
    const body = rows.map(
      (r) => `${r.label} | ${r.side} | ${r.count} | ${r.reviews} | ${r.nearest}`,
    );
    out["count-table"] = [header, divider, ...body].join("\n");
  }

  // sports-areas
  if (doc.sportsAreas) {
    const sa = doc.sportsAreas;
    const lines = [sa.headline, ""];
    for (const r of sa.rows) {
      lines.push(`• ${r.name} — ${r.category}, ${r.distance}, ${r.rating} ★, ${r.reviews} reviews`);
    }
    out["sports-areas"] = lines.join("\n");
  }

  // ai-summary
  if (doc.aiSummary) {
    out["ai-summary"] = doc.aiSummary.summary;
  }

  // suggestions
  if (doc.suggestions) {
    out["suggestions"] = doc.suggestions.text;
  }

  // map — visual, but indicate what it shows
  out["map"] = [
    `Map: ${doc.catchment.radiusLine}`,
    doc.catchment.areaLine,
    doc.competition.headline,
  ].join("\n");

  // sweep
  if (doc.sweep) {
    const lines = [doc.sweep.summary, ""];
    for (const r of doc.sweep.rows) {
      lines.push(`• ${r.status}: ${r.note} (${r.coordinates})`);
    }
    out["sweep"] = lines.join("\n");
  }

  // field-notes
  if (doc.observations?.fieldNotes) {
    out["field-notes"] = doc.observations.fieldNotes;
  }

  // analysis-overview
  if (doc.analysisOverview) {
    const ao = doc.analysisOverview;
    const lines = [
      `Market Saturation: ${ao.marketSaturation.level}`,
      ao.marketSaturation.explanation,
      "",
      `Opportunity Score: ${ao.opportunityScore.score}/10`,
      ao.opportunityScore.reasoning,
      "",
      "Executive Recommendation:",
      ao.executiveRecommendation,
    ];
    if (ao.risks.length > 0) {
      lines.push("", "Risks:");
      for (const r of ao.risks) lines.push(`• ${r}`);
    }
    if (ao.oneLineStrategy) {
      lines.push("", `Strategy: ${ao.oneLineStrategy}`);
    }
    if (ao.competitorLearnings.length > 0) {
      lines.push("", "Competitor Learnings:");
      for (const cl of ao.competitorLearnings) {
        lines.push(`• ${cl.complaint} (seen at ${cl.seenAt}) → ${cl.ourRule}`);
      }
    }
    if (ao.opportunities.length > 0) {
      lines.push("", "Opportunities:");
      for (const op of ao.opportunities) {
        lines.push(`• ${op.title}: ${op.detail}`);
      }
    }
    out["analysis-overview"] = lines.join("\n");
  }

  // place-insights
  if (doc.placeInsights) {
    const lines: string[] = [];
    for (const p of doc.placeInsights.places) {
      if (lines.length > 0) lines.push("", "---", "");
      lines.push(
        `${p.name}`,
        `Established: ${p.establishedDate}`,
        `Popular times: ${p.popularTimes}`,
        `Google reviews: ${p.googleReviewsTone} — ${p.googleReviewsSummary}`,
        `Social media: ${p.socialMediaSummary}`,
        `Suitability: ${p.suitability} (${p.confidence})`,
        p.suitabilityReasoning,
      );
      if (p.whatWorks.length > 0) {
        lines.push("What works: " + p.whatWorks.join("; "));
      }
      if (p.whatDoesnt.length > 0) {
        lines.push("What doesn't: " + p.whatDoesnt.join("; "));
      }
    }
    out["place-insights"] = lines.join("\n");
  }

  // limitations
  out["limitations"] = [
    ...doc.limitations.paragraphs,
    "",
    ...doc.limitations.bullets.map((b) => `• ${b}`),
  ].join("\n");

  return out;
}

/**
 * Apply user-edited section text overrides to a built document.
 *
 * For text-only sections the document fields are replaced directly.
 * For structured sections the override is stored on the document so the
 * renderer can show the edited text in place of the structured layout.
 *
 * `field-notes` is already wired through the existing `fieldNotes` path,
 * so it is skipped here.
 */
export function applySectionTextOverrides(
  doc: ReportDocument,
  overrides: Record<string, string>,
): ReportDocument {
  const defaults = sectionTextFromDocument(doc);
  const changed: Record<string, string> = {};

  for (const [blockId, text] of Object.entries(overrides)) {
    if (blockId === "field-notes") continue;
    if (text === defaults[blockId]) continue;
    changed[blockId] = text;
  }

  if (Object.keys(changed).length === 0) return doc;

  let aiSummary = doc.aiSummary;
  let limitations = doc.limitations;
  const rest: Record<string, string> = {};

  for (const [blockId, text] of Object.entries(changed)) {
    switch (blockId) {
      case "ai-summary":
        if (text.trim()) aiSummary = { summary: text } satisfies AiSummarySection;
        break;

      case "limitations": {
        const lines = text.split("\n");
        const paragraphs: string[] = [];
        const bullets: string[] = [];
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith("•") || trimmed.startsWith("-")) {
            bullets.push(trimmed.replace(/^[•\-]\s*/, ""));
          } else {
            paragraphs.push(trimmed);
          }
        }
        limitations = {
          heading: doc.limitations.heading,
          paragraphs: paragraphs.length > 0 ? paragraphs : doc.limitations.paragraphs,
          bullets: bullets.length > 0 ? bullets : doc.limitations.bullets,
        } satisfies LimitationsSection;
        break;
      }

      default:
        rest[blockId] = text;
        break;
    }
  }

  return {
    ...doc,
    aiSummary,
    limitations,
    sectionTextOverrides: Object.keys(rest).length > 0 ? rest : undefined,
  };
}
