"use client";

import { useTheme } from "./ThemeProvider";

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="inline-flex bg-slate-100 rounded-lg p-0.5 w-full">
      <Btn active={theme === "light"} onClick={() => setTheme("light")} title="Light">
        ☀️
      </Btn>
      <Btn active={theme === "system"} onClick={() => setTheme("system")} title="Auto">
        🖥️
      </Btn>
      <Btn active={theme === "dark"} onClick={() => setTheme("dark")} title="Dark">
        🌙
      </Btn>
    </div>
  );
}

function Btn({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex-1 px-2 py-1.5 text-xs rounded-md transition ${
        active
          ? "bg-white text-slate-900 shadow-sm"
          : "text-slate-600 hover:text-slate-900"
      }`}
    >
      {children}
    </button>
  );
}
