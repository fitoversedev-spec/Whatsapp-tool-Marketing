import { requireAdmin } from "@/lib/auth";
import TaxonomyClient from "@/app/(dashboard)/admin/taxonomies/TaxonomyClient";

export default async function CrmTaxonomiesPage() {
  await requireAdmin();
  return <TaxonomyClient />;
}
