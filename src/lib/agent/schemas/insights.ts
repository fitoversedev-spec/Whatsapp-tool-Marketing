import { z } from "zod/v4";

/** set_lead_temperature: the AI's own hot / warm / cold call on a chat. */
export const setLeadTemperatureBody = z.strictObject({
  temperature: z.enum(["HOT", "WARM", "COLD"]),
  /** Why, in a line (e.g. "budget 25 L confirmed, wants to start this month"). */
  reason: z.string().trim().min(3).max(500),
});

export const setLeadTemperatureResponseSchema = z.object({
  conversationId: z.string(),
  applied: z.boolean(),
  temperature: z.enum(["HOT", "WARM", "COLD"]),
  source: z.enum(["agent", "human"]),
  message: z.string().optional(),
});
