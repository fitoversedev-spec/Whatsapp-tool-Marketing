import { requireUser } from "@/lib/auth";
import SearchClient from "./SearchClient";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  await requireUser();
  return <SearchClient initialQuery={searchParams.q ?? ""} />;
}
