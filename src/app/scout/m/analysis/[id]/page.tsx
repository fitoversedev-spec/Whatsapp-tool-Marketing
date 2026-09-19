import { AnalysisScreen } from "./AnalysisScreen";

export default function MobileAnalysisPage({ params }: { params: { id: string } }) {
  return <AnalysisScreen scanId={params.id} />;
}
