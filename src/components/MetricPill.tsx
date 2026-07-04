type MetricPillProps = {
  label: string;
  value: string | number;
};

export function MetricPill({ label, value }: MetricPillProps) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
        {value}
      </p>
    </div>
  );
}
