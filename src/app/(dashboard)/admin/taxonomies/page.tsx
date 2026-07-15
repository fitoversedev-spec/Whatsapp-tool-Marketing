import { requireAdmin } from "@/lib/auth";
import TaxonomyClient from "./TaxonomyClient";

export default async function TaxonomiesPage() {
  await requireAdmin();
  return <TaxonomyClient />;
}
