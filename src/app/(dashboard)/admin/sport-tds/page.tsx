import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getTdsFilesForSport, type SportTdsFile } from "@/lib/court-image/sport-tds";
import SportTdsClient from "./SportTdsClient";

const SPORTS = [
  "football",
  "cricket",
  "basketball",
  "pickleball",
  "tennis",
  "badminton",
  "volleyball",
  "multisport",
] as const;

export default async function SportTdsPage() {
  const user = await requireUser();
  if (user.role !== "admin") {
    redirect("/inbox");
  }
  const initial: Record<string, SportTdsFile[]> = {};
  for (const sport of SPORTS) {
    initial[sport] = await getTdsFilesForSport(sport);
  }
  return <SportTdsClient sports={SPORTS as unknown as string[]} initial={initial} />;
}
