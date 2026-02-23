import Link from "next/link";
//app/page.js
export default function Home() {
  return (
    <main className="min-h-screen px-5 py-10 md:px-8">
      <section className="mx-auto max-w-3xl rounded-3xl border border-line/80 bg-panel/90 p-8 shadow-[0_18px_50px_rgba(37,35,27,0.12)]">
        <p className="mb-3 inline-flex rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold tracking-[0.18em] text-accent">
          POLYPRO
        </p>
        <h1 className="text-3xl font-semibold leading-tight text-foreground md:text-4xl">
          Manual vs METAR Daily Max
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-black/70">
          Paste your daily max temperatures for the month, then compute archived
          METAR daily maxima for KORD to compare side by side.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/kord/month"
            className="inline-flex items-center rounded-full border border-accent bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-black"
          >
            Open KORD Month Tool
          </Link>
          <Link
            href="/kord/today"
            className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-5 py-2.5 text-sm font-semibold text-emerald-800 transition hover:-translate-y-0.5 hover:border-emerald-400"
          >
            Open KORD Live Today
          </Link>
          <Link
            href="/notes"
            className="inline-flex items-center rounded-full border border-black/15 bg-white/70 px-5 py-2.5 text-sm font-semibold text-black transition hover:-translate-y-0.5 hover:border-black"
          >
            Open Notes
          </Link>
        </div>
      </section>
    </main>
  );
}
