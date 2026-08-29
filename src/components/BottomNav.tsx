"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";

interface BottomNavProps {
  reminderCount: number;
}

export default function BottomNav({ reminderCount }: BottomNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isCrm = pathname.startsWith("/crm") || pathname.startsWith("/deals") || pathname.startsWith("/pipeline");

  const reminderPath = isCrm ? "/crm/reminders" : "/reminders";
  const isReminders = pathname.startsWith("/reminders") || pathname.startsWith("/crm/reminders");

  const handleMenu = useCallback(() => {
    window.dispatchEvent(new Event("toggle-sidebar"));
  }, []);

  const handleNewQuote = useCallback(() => {
    const quotePath = isCrm ? "/crm/quotations" : "/quotations";
    router.push(`${quotePath}?new=1`);
  }, [isCrm, router]);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-white border-t border-slate-200 safe-area-bottom">
      <div className="flex items-center justify-around h-14">
        {/* Menu */}
        <button
          onClick={handleMenu}
          className="flex flex-col items-center justify-center gap-0.5 px-3 py-1 text-slate-500 active:text-slate-900 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span className="text-[10px] font-medium">Menu</span>
        </button>

        {/* New Quote */}
        <button
          onClick={handleNewQuote}
          className="flex flex-col items-center justify-center gap-0.5 px-3 py-1 text-slate-500 active:text-wa-green transition-colors"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          <span className="text-[10px] font-medium">New Quote</span>
        </button>

        {/* Reminders */}
        <button
          onClick={() => router.push(reminderPath)}
          className={`flex flex-col items-center justify-center gap-0.5 px-3 py-1 transition-colors ${
            isReminders ? "text-wa-green" : "text-slate-500 active:text-wa-green"
          }`}
        >
          <div className="relative">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
            {reminderCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-orange-500 text-white text-[10px] font-bold px-1">
                {reminderCount > 99 ? "99+" : reminderCount}
              </span>
            )}
          </div>
          <span className="text-[10px] font-medium">Reminders</span>
        </button>
      </div>
    </nav>
  );
}
