"use client";

import ErrorScreen from "@/components/ErrorScreen";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen error={error} reset={reset} homeHref="/crm" homeLabel="Go to CRM dashboard" />;
}
