"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { onCrossTab } from "@/lib/cross-tab";

export default function CrossTabRefresh({ events }: { events: string[] }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const debouncedRefresh = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 300);
    };

    const cleanups = events.map((event) =>
      onCrossTab(event as Parameters<typeof onCrossTab>[0], debouncedRefresh),
    );
    return () => {
      cleanups.forEach((fn) => fn());
      if (timer.current) clearTimeout(timer.current);
    };
  }, [events, router]);

  return null;
}
