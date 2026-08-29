"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { onCrossTab } from "@/lib/cross-tab";

export default function CrossTabRefresh({ events }: { events: string[] }) {
  const router = useRouter();

  useEffect(() => {
    const cleanups = events.map((event) =>
      onCrossTab(event as Parameters<typeof onCrossTab>[0], () => {
        router.refresh();
      }),
    );
    return () => cleanups.forEach((fn) => fn());
  }, [events, router]);

  return null;
}
