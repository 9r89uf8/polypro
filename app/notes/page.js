import Link from "next/link";
import NotesWorkspaceClient from "./NotesWorkspaceClient";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

function normalizeStationInput(value) {
  return String(value ?? "").trim().toUpperCase();
}

function MissingConvexSetup() {
  return (
    <main className="min-h-screen px-5 py-10 md:px-8">
      <section className="mx-auto max-w-3xl rounded-3xl border border-line/80 bg-panel/90 p-8 shadow-[0_18px_50px_rgba(37,35,27,0.12)]">
        <h1 className="text-2xl font-semibold text-foreground">
          Convex URL Needed
        </h1>
        <p className="mt-3 text-black/70">
          Set <code className="rounded bg-black/5 px-1">NEXT_PUBLIC_CONVEX_URL</code>{" "}
          and run <code className="rounded bg-black/5 px-1">npx convex dev</code>{" "}
          to use notes.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex rounded-full border border-black/15 px-4 py-2 text-sm font-semibold text-black transition hover:border-black hover:text-black"
        >
          Back Home
        </Link>
      </section>
    </main>
  );
}

export default async function NotesPage({ searchParams }) {
  if (!convexUrl) {
    return <MissingConvexSetup />;
  }

  const resolvedSearchParams = (await searchParams) ?? {};
  const prefilledStationIcao = normalizeStationInput(
    resolvedSearchParams.stationIcao,
  );

  return (
    <NotesWorkspaceClient prefilledStationIcao={prefilledStationIcao} />
  );
}
