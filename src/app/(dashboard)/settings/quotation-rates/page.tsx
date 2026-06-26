import { requireUser } from "@/lib/auth";
import { getFootballRates } from "@/lib/quotation/rates";
import RatesEditorClient from "./RatesEditorClient";

export default async function QuotationRatesPage() {
  await requireUser();
  const items = await getFootballRates();
  return <RatesEditorClient initialItems={items} />;
}
