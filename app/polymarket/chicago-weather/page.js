"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

function formatCents(value) {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}¢`;
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}

function formatIsoDateTime(isoString) {
  if (!isoString) return "—";
  const timestamp = Date.parse(isoString);
  if (!Number.isFinite(timestamp)) return isoString;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export default function ChicagoWeatherMarketsPage() {
  const [amount, setAmount] = useState("20");
  const [depth, setDepth] = useState("25");
  const [slugs, setSlugs] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState(null);
  const [showLlmJson, setShowLlmJson] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");

  const requestUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("amount", amount || "20");
    params.set("depth", depth || "25");
    if (slugs.trim()) {
      params.set("slugs", slugs.trim());
    }
    return `/api/polymarket/chicago-weather?${params.toString()}`;
  }, [amount, depth, slugs]);

  async function loadMarkets() {
    setIsLoading(true);
    setError("");
    try {
      const res = await fetch(requestUrl, {
        method: "GET",
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      setResponse(data);
    } catch (err) {
      setResponse(null);
      setError(err?.message || "Request failed");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadMarkets();
    // Initial fetch on first render; later refreshes are user-triggered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const llmPayload = useMemo(() => {
    if (!response) return null;
    return {
      generatedAt: response.generatedAt ?? null,
      eventSlugs: response.eventSlugs ?? [],
      amountUsd: response.amountUsd ?? null,
      depth: response.depth ?? null,
      events: (response.events ?? []).map((event) => ({
        id: event?.id ?? null,
        slug: event?.slug ?? null,
        title: event?.title ?? null,
        markets: (event?.markets ?? []).map((market) => ({
          id: market?.id ?? null,
          slug: market?.slug ?? null,
          label: market?.label ?? null,
          tokens: market?.tokens ?? null,
          yes: {
            bestAskCents: market?.yes?.bestAskCents ?? null,
            bestBidCents: market?.yes?.bestBidCents ?? null,
            lastTradePriceCents: market?.yes?.lastTradePriceCents ?? null,
            quoteSource: market?.yes?.quoteSource ?? null,
            estimateForAmount: market?.yes?.estimateForAmount ?? null,
          },
          no: {
            bestAskCents: market?.no?.bestAskCents ?? null,
            bestBidCents: market?.no?.bestBidCents ?? null,
            estimateForAmount: market?.no?.estimateForAmount ?? null,
          },
        })),
      })),
    };
  }, [response]);

  const llmJsonText = useMemo(
    () => (llmPayload ? JSON.stringify(llmPayload, null, 2) : ""),
    [llmPayload],
  );

  async function copyLlmJson() {
    if (!llmJsonText) return;
    try {
      await navigator.clipboard.writeText(llmJsonText);
      setCopyStatus("Copied.");
    } catch {
      setCopyStatus("Copy failed.");
    }
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-8">
      <section className="mx-auto max-w-7xl rounded-3xl border border-line/80 bg-panel/90 p-5 shadow-[0_18px_50px_rgba(37,35,27,0.12)] md:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="inline-flex rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold tracking-[0.18em] text-accent">
              POLYMARKET
            </p>
            <h1 className="mt-3 text-2xl font-semibold text-foreground md:text-3xl">
              Chicago Weather Markets
            </h1>
            <p className="mt-2 text-sm text-black/70">
              Defaults to Chicago today + next 2 days unless you pass custom slugs.
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center rounded-full border border-black/15 bg-white/70 px-4 py-2 text-sm font-semibold text-black transition hover:-translate-y-0.5 hover:border-black"
          >
            Back Home
          </Link>
        </div>

        <form
          className="mt-6 grid gap-3 rounded-2xl border border-line bg-white/70 p-4 md:grid-cols-[140px_140px_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void loadMarkets();
          }}
        >
          <label className="text-sm font-medium text-black/75">
            Amount (USD)
            <input
              type="number"
              min="0"
              step="1"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none ring-accent focus:ring-2"
            />
          </label>

          <label className="text-sm font-medium text-black/75">
            Orderbook Depth
            <input
              type="number"
              min="1"
              max="100"
              step="1"
              value={depth}
              onChange={(event) => setDepth(event.target.value)}
              className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none ring-accent focus:ring-2"
            />
          </label>

          <label className="text-sm font-medium text-black/75">
            Slugs override (optional, comma separated)
            <input
              type="text"
              value={slugs}
              onChange={(event) => setSlugs(event.target.value)}
              placeholder="highest-temperature-in-chicago-on-june-13-2026,highest-temperature-in-chicago-on-june-14-2026"
              className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm outline-none ring-accent focus:ring-2"
            />
          </label>

          <button
            type="submit"
            className="h-11 self-end rounded-xl border border-accent bg-accent px-5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-black disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isLoading}
          >
            {isLoading ? "Loading..." : "Refresh"}
          </button>
        </form>

        <div className="mt-4 rounded-2xl border border-line bg-white/70 p-3 text-xs text-black/65 md:text-sm">
          <div>Requested URL: {requestUrl}</div>
          <div>Generated: {formatIsoDateTime(response?.generatedAt)}</div>
          <div className="mt-1">
            Active slugs: {response?.eventSlugs?.join(", ") || "—"}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowLlmJson((value) => !value)}
              className="rounded-lg border border-accent/25 bg-accent-soft px-3 py-1.5 text-xs font-semibold text-accent transition hover:border-accent"
            >
              {showLlmJson ? "Hide LLM JSON" : "Show LLM JSON"}
            </button>
            <button
              type="button"
              onClick={() => void copyLlmJson()}
              disabled={!llmJsonText}
              className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-xs font-semibold text-black transition hover:border-black disabled:cursor-not-allowed disabled:opacity-40"
            >
              Copy LLM JSON
            </button>
            {copyStatus ? <span className="self-center text-xs">{copyStatus}</span> : null}
          </div>
        </div>

        {showLlmJson ? (
          <section className="mt-4 overflow-hidden rounded-2xl border border-line bg-[#181b21]">
            <header className="border-b border-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white/70">
              LLM JSON Payload
            </header>
            <pre className="max-h-[420px] overflow-auto p-4 text-xs leading-5 text-emerald-200">
              {llmJsonText || "{}"}
            </pre>
          </section>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            Error: {error}
          </div>
        ) : null}

        <div className="mt-6 space-y-5">
          {(response?.events || []).map((event, eventIndex) => (
            <article
              key={event?.slug || event?.id || `event-${eventIndex}`}
              className="overflow-hidden rounded-2xl border border-line bg-white/75"
            >
              <header className="border-b border-line bg-accent-soft/65 px-4 py-3">
                <h2 className="text-base font-semibold text-black md:text-lg">
                  {event?.title || event?.slug || "Event"}
                </h2>
                <p className="mt-1 text-xs text-black/65">{event?.slug || "—"}</p>
              </header>

              <div className="overflow-x-auto">
                <table className="min-w-[860px] w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-black/[0.035] text-left text-xs uppercase tracking-wide text-black/70">
                      <th className="px-4 py-2 font-semibold">Market</th>
                      <th className="px-4 py-2 font-semibold">YES Ask/Bid</th>
                      <th className="px-4 py-2 font-semibold">YES Fill</th>
                      <th className="px-4 py-2 font-semibold">NO Ask/Bid</th>
                      <th className="px-4 py-2 font-semibold">NO Fill</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(event?.markets || []).map((market) => (
                      <tr
                        key={market?.slug || market?.id || `${event?.slug}-${market?.label}`}
                        className="border-t border-line/80"
                      >
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium text-black">{market?.label || "—"}</div>
                          <div className="mt-1 text-xs text-black/60">{market?.slug || "—"}</div>
                        </td>

                        <td className="px-4 py-3 align-top text-black/80">
                          <div>Ask: {formatCents(market?.yes?.bestAskCents)}</div>
                          <div>Bid: {formatCents(market?.yes?.bestBidCents)}</div>
                        </td>

                        <td className="px-4 py-3 align-top text-black/80">
                          <div>
                            Avg:{" "}
                            {formatCents(market?.yes?.estimateForAmount?.avgPriceCents)}
                          </div>
                          <div>
                            Shares:{" "}
                            {Number.isFinite(market?.yes?.estimateForAmount?.amountUsd) &&
                            Number.isFinite(market?.yes?.estimateForAmount?.shares)
                              ? `${formatUsd(market.yes.estimateForAmount.amountUsd)} gets you ${market.yes.estimateForAmount.shares.toFixed(2)} shares`
                              : "—"}
                          </div>
                          <div>
                            To win:{" "}
                            {Number.isFinite(market?.yes?.estimateForAmount?.toWinUsd) &&
                            Number.isFinite(market?.yes?.estimateForAmount?.amountUsd)
                              ? `${formatUsd(market.yes.estimateForAmount.toWinUsd)} including the ${formatUsd(market.yes.estimateForAmount.amountUsd)} investment`
                              : "—"}
                          </div>
                        </td>

                        <td className="px-4 py-3 align-top text-black/80">
                          <div>Ask: {formatCents(market?.no?.bestAskCents)}</div>
                          <div>Bid: {formatCents(market?.no?.bestBidCents)}</div>
                        </td>

                        <td className="px-4 py-3 align-top text-black/80">
                          <div>
                            Avg: {formatCents(market?.no?.estimateForAmount?.avgPriceCents)}
                          </div>
                          <div>
                            Shares:{" "}
                            {Number.isFinite(market?.no?.estimateForAmount?.amountUsd) &&
                            Number.isFinite(market?.no?.estimateForAmount?.shares)
                              ? `${formatUsd(market.no.estimateForAmount.amountUsd)} gets you ${market.no.estimateForAmount.shares.toFixed(2)} shares`
                              : "—"}
                          </div>
                          <div>
                            To win:{" "}
                            {Number.isFinite(market?.no?.estimateForAmount?.toWinUsd) &&
                            Number.isFinite(market?.no?.estimateForAmount?.amountUsd)
                              ? `${formatUsd(market.no.estimateForAmount.toWinUsd)} including the ${formatUsd(market.no.estimateForAmount.amountUsd)} investment`
                              : "—"}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
