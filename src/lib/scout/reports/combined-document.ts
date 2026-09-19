import type { ReportDocument, ReportSectionId } from "./types";

export function buildCombinedDocument(
  scanDoc: ReportDocument,
  analysisDoc: ReportDocument,
): ReportDocument {
  const scanSections = scanDoc.sections.filter((s) => s !== "limitations");
  const analysisSections: ReportSectionId[] = [];
  if (analysisDoc.analysisOverview) analysisSections.push("analysisOverview");
  if (analysisDoc.placeInsights) analysisSections.push("placeInsights");
  analysisSections.push("limitations");

  return {
    ...scanDoc,
    meta: {
      ...scanDoc.meta,
      title: `${scanDoc.meta.areaLabel} — Combined Report`,
    },
    sections: [...scanSections, ...analysisSections],
    analysisOverview: analysisDoc.analysisOverview,
    placeInsights: analysisDoc.placeInsights,
    limitations: {
      heading: scanDoc.limitations.heading,
      paragraphs: [
        ...scanDoc.limitations.paragraphs,
        ...(analysisDoc.limitations.paragraphs.length > 0
          ? ["", "AI analysis limitations:", ...analysisDoc.limitations.paragraphs]
          : []),
      ],
      bullets: [
        ...new Set([...scanDoc.limitations.bullets, ...analysisDoc.limitations.bullets]),
      ],
    },
  };
}
