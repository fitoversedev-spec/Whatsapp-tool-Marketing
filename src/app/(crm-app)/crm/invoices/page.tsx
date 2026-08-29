import { requireUser } from "@/lib/auth";
import InvoicesClient from "@/app/(dashboard)/invoices/InvoicesClient";

export default async function CrmInvoicesPage() {
  await requireUser();
  return <InvoicesClient basePath="/crm" />;
}
