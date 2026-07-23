// Persistent "you are in the CRM" indicator. Rendered as a slim band above the
// CRM tab bar (crm/layout) and in the headers of /deals + /pipeline — pages
// that are conceptually CRM but live outside crm/layout. Brand green (#159341)
// hard-coded rather than via a Tailwind token: wa-green is the WhatsApp green,
// not the Fitoverse brand green this badge is meant to signal.
export default function CrmBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-[#159341]/10 text-[#159341] whitespace-nowrap">
      <span className="w-1.5 h-1.5 rounded-full bg-[#159341]" />
      CRM
    </span>
  );
}
