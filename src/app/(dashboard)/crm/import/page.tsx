import { requireUser } from "@/lib/auth";
import ImportWizardClient from "./ImportWizardClient";

export default async function ImportPage() {
  await requireUser();
  return <ImportWizardClient />;
}
