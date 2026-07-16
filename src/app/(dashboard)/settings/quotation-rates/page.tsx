import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { isAdmin } from "@/lib/rbac";
import { getRatesForSport, SUPPORTED_SPORTS, type Sport } from "@/lib/quotation/rates";
import RatesEditorClient from "./RatesEditorClient";

export default async function QuotationRatesPage({
  searchParams,
}: {
  searchParams: { sport?: string };
}) {
  const user = await requireUser();
  // Rate editing is admin-only (see docs/DECISIONS.md) — sales still gets
  // rates automatically inside the quote wizard, which reads them directly
  // rather than via this management page, so there's nothing for a sales
  // user to do here.
  if (!isAdmin(user.role)) {
    redirect("/quotations");
  }
  const raw = searchParams.sport;
  const sport: Sport = SUPPORTED_SPORTS.includes(raw as Sport) ? (raw as Sport) : "football";
  const items = await getRatesForSport(sport);
  return <RatesEditorClient initialItems={items} initialSport={sport} />;
}
