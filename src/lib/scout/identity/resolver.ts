import "server-only";

import { getCurrentUser } from "@/lib/auth";

import type { ScoutIdentity, ScoutProfile } from "./types";

/**
 * Maps the host's role string onto Scout's two-permission model.
 *
 * Every approved user can run scans. Only admins can edit scoring weights
 * (which also grants visibility of all scans — see types.ts).
 */
function toIdentity(role: string): Omit<ScoutIdentity, "userId"> {
  return {
    canRunScans: true,
    canEditScoringWeights: role === "admin",
  };
}

export async function getScoutIdentity(): Promise<ScoutIdentity | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return { userId: user.id, ...toIdentity(user.role) };
}

export async function getScoutProfile(): Promise<ScoutProfile | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  return {
    userId: user.id,
    displayName: user.name,
    email: user.email,
    ...toIdentity(user.role),
  };
}
