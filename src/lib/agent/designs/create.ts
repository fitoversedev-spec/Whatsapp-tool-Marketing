/**
 * create_design_draft: an empty draft design for a customer, from a sport and a
 * plot size only. The pictures are drawn in a person's browser, so the AI cannot
 * make them and cannot attach any (the request accepts no picture, layout or
 * phone); a team member opens the draft in the Court Designer and draws it.
 */
import type { z } from "zod/v4";
import { createCourtImageRow } from "@/lib/court-image/create";
import { buildInitialLayout, SPORT_LABEL } from "@/lib/court-image/schema";
import { AgentHttpError } from "../errors";
import type { createDesignDraftBodySchema } from "../schemas/documents";
import type { AgentHandler } from "../withAgent";
import { resolveDesignCustomer } from "./customer";
import { toDesignDto } from "./reads";

export const NEEDS_DRAWING_NOTE =
  "This is an empty draft. A team member has to open it in the Court Designer and draw the layout and the 2D / 3D pictures before it can be sent to the customer.";

export const createDesignDraft: AgentHandler<z.infer<typeof createDesignDraftBodySchema>> = async ({ ctx, input }) => {
  const customer = await resolveDesignCustomer(input);
  const plot = { lengthFt: input.lengthFt, widthFt: input.widthFt };
  const title = input.title ?? `${customer.name} — ${input.lengthFt}x${input.widthFt} ft ${SPORT_LABEL[input.sport]}`;
  const layout = buildInitialLayout({ plot, sports: [input.sport], title });

  const row = await createCourtImageRow({
    customerName: customer.name.slice(0, 200),
    layout: JSON.stringify(layout),
    // The customer's own links only; no picture, no free-typed phone.
    conversationId: customer.conversationId,
    contactPhone: customer.phone,
    accountContactId: customer.accountContactId,
    createdByUserId: ctx.userId,
  });
  if (!row) throw new AgentHttpError("internal", "Could not assign a design number. Try again in a moment.", 503);

  return {
    body: {
      design: toDesignDto(row, { sports: [input.sport], plot }, ctx.userId),
      note: NEEDS_DRAWING_NOTE,
    },
    recordIds: [row.id],
    fieldsChanged: ["design"],
  };
};
