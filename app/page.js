"use client";

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
          Airport Weather Toolkit
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-black/70">
          Compare KORD monthly manual vs METAR highs, open live airport day charts,
          track forecast snapshots, review official SBGR REDEMET METAR history,
          and keep notes in one place.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/kord/month"
            className="inline-flex items-center rounded-full border border-accent bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-black"
          >
            Open KORD Month Tool
          </Link>
          <Link
            href="/kord/metar-today"
            className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-5 py-2.5 text-sm font-semibold text-sky-800 transition hover:-translate-y-0.5 hover:border-sky-400"
          >
            Open METAR Live Day Chart
          </Link>
          <Link
            href="/kord/today"
            className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-5 py-2.5 text-sm font-semibold text-emerald-800 transition hover:-translate-y-0.5 hover:border-emerald-400"
          >
            Open KORD Phone Calls Today
          </Link>
          <Link
            href="/kord/forecast-snapshots"
            className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-5 py-2.5 text-sm font-semibold text-amber-900 transition hover:-translate-y-0.5 hover:border-amber-400"
          >
            Open Forecast Snapshots
          </Link>
          <Link
            href="/sbgr/today"
            className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-5 py-2.5 text-sm font-semibold text-rose-900 transition hover:-translate-y-0.5 hover:border-rose-400"
          >
            Open SBGR Official Day Chart
          </Link>
          <Link
            href="/polymarket/chicago-weather"
            className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-5 py-2.5 text-sm font-semibold text-indigo-900 transition hover:-translate-y-0.5 hover:border-indigo-400"
          >
            Open Polymarket Chicago
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
