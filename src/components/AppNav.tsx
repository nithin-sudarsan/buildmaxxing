import Link from "next/link";

const links = [
  { href: "/", label: "Cafes" },
  { href: "/?feedback=1", label: "Feedback" },
];

export function AppNav() {
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200/70 bg-stone-50/90 backdrop-blur-xl dark:border-zinc-800 dark:bg-zinc-950/88">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
            BuildMaxxing
          </span>
          <span className="hidden text-xs font-medium text-zinc-500 dark:text-zinc-400 sm:inline">
            London workcafes
          </span>
        </Link>
        <nav className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white p-1 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full px-3 py-2 font-medium text-zinc-600 transition hover:bg-emerald-50 hover:text-emerald-800 active:translate-y-px dark:text-zinc-300 dark:hover:bg-emerald-400/10 dark:hover:text-emerald-200"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
