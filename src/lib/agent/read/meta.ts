import { listLeadStages } from "@/lib/crm/leadStages";
import { listTaxonomy } from "@/lib/taxonomy";
import { PRODUCT_TYPES } from "@/lib/products/store";
import { SUPPORTED_SPORTS } from "@/lib/quotation/rates";
import { listAdLeadStages } from "./adLeads";

type Named = { id: string; name: string; isActive?: boolean };

const activeNames = (rows: unknown[]): { id: string; name: string }[] =>
  (rows as Named[]).filter((r) => r.isActive !== false).map((r) => ({ id: r.id, name: r.name }));

/** The CRM vocabulary an agent needs to filter and describe records: names and ids only. */
export async function getCrmMeta() {
  const [leadStages, leadSources, activityTypes, customerProfiles, adLeadStages] = await Promise.all([
    listLeadStages(),
    listTaxonomy("lead-sources"),
    listTaxonomy("activity-types"),
    listTaxonomy("customer-profiles"),
    listAdLeadStages(),
  ]);
  return {
    // Inactive stages stay listed (leads may still sit in them) but are flagged.
    leadStages: leadStages.map((s) => ({ id: s.id, name: s.name, isActive: s.isActive })),
    leadSources: activeNames(leadSources),
    activityTypes: activeNames(activityTypes),
    customerProfiles: activeNames(customerProfiles),
    supportedSports: [...SUPPORTED_SPORTS],
    productTypes: [...PRODUCT_TYPES],
    adLeadStages,
  };
}
