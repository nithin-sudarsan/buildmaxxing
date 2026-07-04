"use client";

import { useState } from "react";
import { Lightning, Play, SpinnerGap } from "@phosphor-icons/react";
import type { Cafe, WorkBuddyResponse } from "@/lib/types";

type WorkBuddyPanelProps = {
  cafe: Cafe;
};

export function WorkBuddyPanel({ cafe }: WorkBuddyPanelProps) {
  const [task, setTask] = useState("Finish my hackathon pitch");
  const [duration, setDuration] = useState("3 hours");
  const [plan, setPlan] = useState<WorkBuddyResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createPlan() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/agent/work-buddy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, duration, cafeName: cafe.name }),
      });
      if (!response.ok) throw new Error("Plan request failed");
      setPlan((await response.json()) as WorkBuddyResponse);
    } catch {
      setError("Could not create a plan. Try again with a shorter task.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-[1.35rem] border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-400/20 dark:bg-emerald-400/10">
      <div className="flex items-start gap-3">
        <div className="rounded-2xl bg-emerald-700 p-2 text-white dark:bg-emerald-300 dark:text-zinc-950">
          <Lightning size={20} weight="bold" />
        </div>
        <div>
          <h3 className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            Work Buddy
          </h3>
          <p className="mt-1 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
            Turn this cafe choice into a focused session plan.
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_140px]">
        <div className="grid gap-2">
          <label
            htmlFor={`task-${cafe.id}`}
            className="text-sm font-semibold text-zinc-800 dark:text-zinc-200"
          >
            What do you need to finish?
          </label>
          <input
            id={`task-${cafe.id}`}
            value={task}
            onChange={(event) => setTask(event.target.value)}
            className="h-12 rounded-2xl border border-emerald-200 bg-white px-4 text-sm font-medium text-zinc-950 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/15 dark:border-emerald-400/20 dark:bg-zinc-950 dark:text-zinc-50"
          />
        </div>
        <div className="grid gap-2">
          <label
            htmlFor={`duration-${cafe.id}`}
            className="text-sm font-semibold text-zinc-800 dark:text-zinc-200"
          >
            Duration
          </label>
          <input
            id={`duration-${cafe.id}`}
            value={duration}
            onChange={(event) => setDuration(event.target.value)}
            className="h-12 rounded-2xl border border-emerald-200 bg-white px-4 text-sm font-medium text-zinc-950 outline-none transition focus:border-emerald-600 focus:ring-4 focus:ring-emerald-600/15 dark:border-emerald-400/20 dark:bg-zinc-950 dark:text-zinc-50"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={createPlan}
        disabled={loading}
        className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60 dark:bg-emerald-300 dark:text-zinc-950 dark:hover:bg-emerald-200"
      >
        {loading ? <SpinnerGap size={18} className="animate-spin" /> : <Play size={18} weight="bold" />}
        Create plan
      </button>

      {error ? (
        <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="mt-5 grid gap-2">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-12 animate-pulse rounded-2xl bg-emerald-200/60 dark:bg-emerald-300/10"
            />
          ))}
        </div>
      ) : null}

      {plan ? (
        <ol className="mt-5 grid gap-2">
          {plan.plan.map((item) => (
            <li
              key={`${item.time}-${item.task}`}
              className="grid gap-1 rounded-2xl bg-white p-4 dark:bg-zinc-950"
            >
              <span className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                {item.time}
              </span>
              <span className="text-sm font-medium leading-6 text-zinc-800 dark:text-zinc-200">
                {item.task}
              </span>
            </li>
          ))}
          <li className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Agent mode: {plan.provider}
          </li>
        </ol>
      ) : null}
    </section>
  );
}
