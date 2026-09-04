"use server";

import { revalidatePath } from "next/cache";
import { requireScoutIdentity } from "@/lib/scout/identity";
import {
  getActiveScoreModel,
  createScoreModel,
  activateScoreModel,
} from "@/lib/scout/siteScore/modelRepository";
import { parseScoreModel, type ScoreModel } from "@/lib/scout/scoring";

export interface ScoringActionState {
  message?: string;
  error?: string;
}

async function requireScoringAccess() {
  const identity = await requireScoutIdentity();
  if (!identity.canEditScoringWeights) throw new Error("Not authorised.");
  return identity;
}

/**
 * Bump the patch version: "1.0.0" -> "1.0.1", "1.0.9" -> "1.0.10", etc.
 */
function bumpPatch(version: string): string {
  const parts = version.split(".");
  if (parts.length !== 3) return "1.0.1";
  const patch = parseInt(parts[2], 10);
  return `${parts[0]}.${parts[1]}.${isNaN(patch) ? 1 : patch + 1}`;
}

export async function updateWeightsAction(
  _prev: ScoringActionState,
  formData: FormData,
): Promise<ScoringActionState> {
  await requireScoringAccess();

  try {
    const weightsJson = formData.get("weights");
    if (!weightsJson || typeof weightsJson !== "string") {
      return { error: "No weights data received." };
    }

    const newWeights = JSON.parse(weightsJson);

    // Load the current active model so we can carry forward non-component fields.
    const { model: current } = await getActiveScoreModel();

    const newVersion = bumpPatch(current.version);

    const newModel: ScoreModel = {
      version: newVersion,
      name: current.name,
      description: `Tuned from ${current.version}. Component weights updated.`,
      includesPopulation: current.includesPopulation,
      weights: {
        ...current.weights,
        components: newWeights.components,
        // Also propagate any sub-component changes if they were sent.
        ...(newWeights.saturation ? { saturation: { ...current.weights.saturation, ...newWeights.saturation } } : {}),
        ...(newWeights.marketProof ? { marketProof: { ...current.weights.marketProof, ...newWeights.marketProof } } : {}),
        ...(newWeights.serviceGap ? { serviceGap: { ...current.weights.serviceGap, ...newWeights.serviceGap } } : {}),
        ...(newWeights.verdictBands ? { verdictBands: newWeights.verdictBands } : {}),
      },
    };

    // Validate — parseScoreModel throws InvalidScoreModelError with a clear
    // message if anything is wrong (sum !== 100, sub-parts mismatch, etc.)
    parseScoreModel(newModel);

    await createScoreModel(newModel);
    revalidatePath("/scout/admin/scoring");
    return { message: `Saved as v${newVersion} and activated.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    return { error: message };
  }
}

export async function activateModelAction(
  _prev: ScoringActionState,
  formData: FormData,
): Promise<ScoringActionState> {
  await requireScoringAccess();

  const modelId = formData.get("modelId");
  if (!modelId || typeof modelId !== "string") {
    return { error: "No model selected." };
  }

  try {
    await activateScoreModel(modelId);
    revalidatePath("/scout/admin/scoring");
    return { message: "Model activated." };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error.";
    return { error: message };
  }
}
