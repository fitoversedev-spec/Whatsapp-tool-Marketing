import { requireUser } from "@/lib/auth";
import InvoiceDetailClient from "./InvoiceDetailClient";

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  await requireUser();
  return <InvoiceDetailClient id={params.id} />;
}
