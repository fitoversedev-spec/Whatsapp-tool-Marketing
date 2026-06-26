import { requireUser } from "@/lib/auth";
import { getRatesForSport, SUPPORTED_SPORTS, type Sport } from "@/lib/quotation/rates";
import RatesEditorClient from "./RatesEditorClient";

export default async function QuotationRatesPage({
  searchParams,
}: {
  searchParams: { sport?: string };
}) {
  await requireUser();
  const raw = searchParams.sport;
  const sport: Sport = SUPPORTED_SPORTS.includes(raw as Sport) ? (raw as Sport) : "football";
  const items = await getRatesForSport(sport);
  return <RatesEditorClient initialItems={items} initialSport={sport} />;
}
