import type { Metadata } from "next";
import BackButton from "@/components/BackButton";
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
    <>
      <div className="px-4 sm:px-6 lg:px-8 pt-3">
        <BackButton backHref="/scout/dashboard" />
      </div>
      <ScreenScaffold
        eyebrow="Settings"
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
    </>
  );
}
