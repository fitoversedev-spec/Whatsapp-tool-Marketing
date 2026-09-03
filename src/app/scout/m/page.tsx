import { redirect } from "next/navigation";

/**
 * `/scout/m` has no screen of its own. The salesperson tapping the home-screen icon
 * wants to start a site check, so it lands on screen 01 — the same destination
 * the manifest's `start_url` names, so the installed app and a typed URL agree.
 */
export default function FieldIndex() {
  redirect("/scout/m/scan");
}
