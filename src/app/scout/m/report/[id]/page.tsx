import { ReportScreen } from "./ReportScreen";

export const metadata = { title: "Report — Site Scout" };

export default async function ReportPage({ params }: { params: { id: string } }) {
  const { id } = params;
  return <ReportScreen scanId={id} />;
}
