import { requireUser } from "@/lib/auth";
import InvoiceDetailClient from "@/app/(dashboard)/invoices/[id]/InvoiceDetailClient";

// The CRM Invoices list and "Convert to invoice" link to /crm/invoices/<id> —
// same invoice page as the marketing app, kept inside the CRM layout.
export default async function CrmInvoiceDetailPage({ params }: { params: { id: string } }) {
  await requireUser();
  return <InvoiceDetailClient id={params.id} basePath="/crm" />;
}
