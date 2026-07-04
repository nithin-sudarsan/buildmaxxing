"use client";

import type { ReactNode } from "react";

type FilterToggleProps = {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
};

export function FilterToggle({ active, onClick, children }: FilterToggleProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-11 rounded-full border px-4 text-sm font-semibold transition active:translate-y-px ${
        active
          ? "border-emerald-700 bg-emerald-700 text-white dark:border-emerald-300 dark:bg-emerald-300 dark:text-zinc-950"
          : "border-zinc-200 bg-white text-zinc-700 hover:border-emerald-700 hover:text-emerald-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-emerald-300 dark:hover:text-emerald-200"
      }`}
    >
      {children}
    </button>
  );
}
