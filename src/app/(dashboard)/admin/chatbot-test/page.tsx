import { requireAdmin } from "@/lib/auth";
import ChatbotTestClient from "./ChatbotTestClient";

export default async function ChatbotTestPage() {
  await requireAdmin();
  return <ChatbotTestClient />;
}
