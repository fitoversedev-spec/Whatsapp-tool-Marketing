import PageHeader from "@/components/PageHeader";
import AnalyticsTab from "./AnalyticsTab";
import WebsiteLeadsTabs from "./WebsiteLeadsTabs";

// The /website-leads page with ?tab=analytics: same header and tab bar as the
// Leads tab, with the analytics sections in place of the table.
export default function WebsiteAnalyticsPage() {
  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <PageHeader
        large
        title="Fito Website"
        description="Leads and visitor analytics from fitoverse.com"
      />
      <div className="mt-4">
        <WebsiteLeadsTabs active="analytics" />
      </div>
      <AnalyticsTab />
    </div>
  );
}
