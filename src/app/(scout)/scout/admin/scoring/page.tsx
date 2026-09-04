import type { Metadata } from "next";
import { ScreenScaffold } from "@/components/scout/patterns";
import {
  getActiveScoreModel,
  listScoreModels,
} from "@/lib/scout/siteScore/modelRepository";
import { WeightsEditor } from "./WeightsEditor";

export const metadata: Metadata = { title: "Scoring Weights — Site Scout admin" };
export const dynamic = "force-dynamic";

export default async function AdminScoringPage() {
  const [{ model }, versions] = await Promise.all([
    getActiveScoreModel(),
    listScoreModels(),
  ]);

  return (
    <ScreenScaffold
      eyebrow="Admin"
      title="Scoring Weights"
      lede="Adjust how the 100-point site viability score is distributed across the five assessment components. Saving creates a new model version."
    >
      <WeightsEditor
        weights={model.weights}
        currentVersion={model.version}
        versions={versions.map((v) => ({
          ...v,
          createdAt: v.createdAt.toISOString(),
        }))}
      />
    </ScreenScaffold>
  );
}
