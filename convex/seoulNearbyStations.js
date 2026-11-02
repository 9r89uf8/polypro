import { internalActionGeneric, internalMutationGeneric, internalQueryGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import { nearbyObservationInput, nearbySource, nearbyStationResult } from "./lib/seoulNearbySchema.js";
import {
  AIRPORT, NEARBY_API_URL, NEARBY_PUBLIC_URL, NEARBY_RETENTION_MS, NEARBY_SOURCE, NEARBY_STATIONS, NEARBY_WINDOW_MINUTES, NearbySourceError,
  kstDate, kstMinuteParam, nearbyAccess, nearbyHttpError, nearbyPublicHttpError, nearbyStationsWithGeometry, parseAwsMinuteResponse, parsePublicAwsPage, sanitizeNearbyError,
} from "./lib/seoulNearbyStations.js";

const MINUTE = 60_000;
const LOCK_TIMEOUT_MS = 2 * MINUTE;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_CHARS = 100_000;
const AMOS_ROWS_READ = 12;
const STATION_ROWS_READ = 12;
const RUNWAYS = { reference: { rwyNo: "2", rwyDir: "15L" }, comparison: { rwyNo: "3", rwyDir: "16L" } };
const STATION_IDS = new Set(NEARBY_STATIONS.map((station) => station.id));
const shiftDate = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const access = () => nearbyAccess(process.env);

function airportOnly(value) {
  const stationIcao = String(value ?? AIRPORT.icao).trim().toUpperCase();
  if (stationIcao !== AIRPORT.icao) throw new Error("The nearby-station panel supports RKSI only.");
  return stationIcao;
}

async function collectorState(ctx, stationIcao) {
  return await ctx.db.query("seoulNearbyCollectorStatus").withIndex("by_station", (q) => q.eq("stationIcao", stationIcao)).first();
}

async function prune(ctx, now) {
  const rows = await ctx.db.query("seoulNearbyStationObservations")
    .withIndex("by_obs_ts", (q) => q.lt("obsTimeUtc", now - NEARBY_RETENTION_MS)).take(256);
  for (const row of rows) await ctx.db.delete(row._id);
  return rows.length;
}

export const queueScheduledRefresh = internalMutationGeneric({
  args: { stationIcao: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const stationIcao = airportOnly(args.stationIcao);
    const { approved, configured } = access();
    if (!approved) return { queued: false, status: "approval_required" };
    if (!configured) return { queued: false, status: "setup_required" };
    const now = Date.now();
    const current = await collectorState(ctx, stationIcao);
    if (Number.isFinite(current?.collectionInFlightSince) && now - current.collectionInFlightSince < LOCK_TIMEOUT_MS) {
      return { queued: false, status: "already_running" };
    }
    if (Number.isFinite(current?.collectionQueuedAt) && Math.floor(current.collectionQueuedAt / MINUTE) === Math.floor(now / MINUTE)) {
      return { queued: false, status: "cooldown" };
    }
    const runId = `${stationIcao}:${now}`;
    const fields = { stationIcao, status: current?.status ?? "building", collectionQueuedAt: now, collectionInFlightSince: now, collectionRunId: runId, updatedAt: now };
    if (current) await ctx.db.patch(current._id, fields);
    else await ctx.db.insert("seoulNearbyCollectorStatus", fields);
    await ctx.scheduler.runAfter(0, internal.seoulNearbyStations.collectLatest, { stationIcao, runId });
    return { queued: true, status: "queued" };
  },
});

// A running action can keep the environment it started with, so the worker asks
// through this query immediately before it contacts KMA.
export const collectionAccess = internalQueryGeneric({
  args: { stationIcao: v.string(), runId: v.string() },
  handler: async (ctx, { stationIcao, runId }) => {
    const { approved, configured, source } = access();
    if (!approved) return { status: "approval_required" };
    if (!configured) return { status: "setup_required" };
    const current = await collectorState(ctx, stationIcao);
    return current?.collectionRunId === runId ? { status: "allowed", source } : { status: "superseded" };
  },
});

export const storeReadings = internalMutationGeneric({
  args: { stationIcao: v.string(), runId: v.string(), source: nearbySource, rows: v.array(nearbyObservationInput) },
  handler: async (ctx, { stationIcao, runId, source, rows }) => {
    if (!access().approvedSources.includes(source)) return { status: "approval_required", insertedCount: 0 };
    const current = await collectorState(ctx, stationIcao);
    if (current?.collectionRunId !== runId) return { status: "superseded", insertedCount: 0 };
    const now = Date.now();
    let insertedCount = 0, revisedCount = 0;
    for (const row of rows) {
      if (!STATION_IDS.has(row.stationId) || row.obsTimeUtc > now + MINUTE || row.obsTimeUtc < now - NEARBY_RETENTION_MS) continue;
      const existing = await ctx.db.query("seoulNearbyStationObservations")
        .withIndex("by_station_obs_ts", (q) => q.eq("stationId", row.stationId).eq("obsTimeUtc", row.obsTimeUtc)).first();
      if (!existing) {
        await ctx.db.insert("seoulNearbyStationObservations", { ...row, source, firstSeenAt: now, updatedAt: now });
        insertedCount += 1;
      } else if (existing.rawLine !== row.rawLine) {
        // KMA can revise a minute. firstSeenAt stays, so delivery delay remains measurable.
        await ctx.db.replace(existing._id, { ...row, source, firstSeenAt: existing.firstSeenAt, updatedAt: now });
        revisedCount += 1;
      }
    }
    await prune(ctx, now);
    return { status: "ok", insertedCount, revisedCount };
  },
});

export const finishRun = internalMutationGeneric({
  args: {
    stationIcao: v.string(), runId: v.string(), source: nearbySource, status: v.string(), lastAttemptAt: v.number(), lastSuccessAt: v.optional(v.number()),
    latestObsTimeUtc: v.optional(v.number()), errorCode: v.optional(v.string()), lastError: v.optional(v.string()), stations: v.array(nearbyStationResult),
  },
  handler: async (ctx, { stationIcao, runId, ...fields }) => {
    if (!access().approvedSources.includes(fields.source)) return { status: "approval_required", updated: false };
    const current = await collectorState(ctx, stationIcao);
    if (current?.collectionRunId !== runId) return { status: "superseded", updated: false };
    const latestObsTimeUtc = Math.max(fields.latestObsTimeUtc ?? 0, current.latestObsTimeUtc ?? 0);
    await ctx.db.patch(current._id, {
      ...fields,
      // A clean run clears the previous failure; undefined removes the field.
      errorCode: fields.errorCode, lastError: fields.lastError,
      lastSuccessAt: fields.lastSuccessAt ?? current.lastSuccessAt,
      latestObsTimeUtc: latestObsTimeUtc || undefined,
      collectionInFlightSince: undefined, collectionRunId: undefined, updatedAt: Date.now(),
    });
    return { status: fields.status, updated: true };
  },
});

async function fetchStation(station, key, now) {
  const url = new URL(NEARBY_API_URL);
  url.searchParams.set("tm1", kstMinuteParam(now - NEARBY_WINDOW_MINUTES * MINUTE));
  url.searchParams.set("tm2", kstMinuteParam(now));
  url.searchParams.set("stn", String(station.id));
  url.searchParams.set("disp", "1");
  url.searchParams.set("help", "0");
  url.searchParams.set("authKey", key);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { redirect: "error", cache: "no-store", signal: controller.signal, headers: { Accept: "text/plain" } });
    if (!response.ok) throw nearbyHttpError(response.status);
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARS) throw new NearbySourceError("format", "KMA response was larger than expected.");
    const { rows } = parseAwsMinuteResponse(text, station.id);
    return { stationId: station.id, status: rows.length ? "ok" : "no_rows", rows };
  } catch (error) {
    const errorCode = error instanceof NearbySourceError ? error.code : "network";
    return { stationId: station.id, status: "error", rows: [], errorCode, error: sanitizeNearbyError(error instanceof Error ? error.message : error, key) };
  } finally {
    clearTimeout(timer);
  }
}

// One request covers every station, so a failure is every station's failure.
async function fetchPublicPage() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(NEARBY_PUBLIC_URL, { redirect: "error", cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw nearbyPublicHttpError(response.status);
    const text = await response.text();
    if (text.length > MAX_RESPONSE_CHARS) throw new NearbySourceError("format", "KMA's public page returned more than expected.");
    const { rows } = parsePublicAwsPage(text);
    return NEARBY_STATIONS.map((station) => {
      const stationRows = rows.filter((row) => row.stationId === station.id);
      return { stationId: station.id, status: stationRows.length ? "ok" : "no_rows", rows: stationRows };
    });
  } catch (error) {
    const errorCode = error instanceof NearbySourceError ? error.code : "network";
    const message = sanitizeNearbyError(error instanceof Error ? error.message : error);
    return NEARBY_STATIONS.map((station) => ({ stationId: station.id, status: "error", rows: [], errorCode, error: message }));
  } finally {
    clearTimeout(timer);
  }
}

export const collectLatest = internalActionGeneric({
  args: { stationIcao: v.string(), runId: v.string() },
  handler: async (ctx, { stationIcao, runId }) => {
    const permission = await ctx.runQuery(internal.seoulNearbyStations.collectionAccess, { stationIcao, runId });
    if (permission.status !== "allowed") return { status: permission.status };
    const { source } = permission, { key } = access();
    if (source === NEARBY_SOURCE && !key) return { status: "setup_required" };
    const lastAttemptAt = Date.now();
    const results = source === NEARBY_SOURCE ? await Promise.all(NEARBY_STATIONS.map((station) => fetchStation(station, key, lastAttemptAt))) : await fetchPublicPage();
    const rows = results.flatMap((result) => result.rows);
    const write = await ctx.runMutation(internal.seoulNearbyStations.storeReadings, { stationIcao, runId, source, rows });
    if (write.status !== "ok") return write;
    const failed = results.filter((result) => result.status === "error");
    const status = failed.length === results.length ? "error" : failed.length || results.some((result) => result.status === "no_rows") ? "partial" : "ok";
    const latest = Math.max(-Infinity, ...rows.map((row) => row.obsTimeUtc));
    const stations = results.map(({ stationId, status: stationStatus, errorCode, rows: stationRows }) => ({
      stationId, status: stationStatus,
      ...(stationRows.length ? { latestObsTimeUtc: Math.max(...stationRows.map((row) => row.obsTimeUtc)) } : {}),
      ...(errorCode ? { errorCode } : {}),
    }));
    await ctx.runMutation(internal.seoulNearbyStations.finishRun, {
      stationIcao, runId, source, status, lastAttemptAt, stations,
      ...(rows.length ? { lastSuccessAt: Date.now(), latestObsTimeUtc: latest } : {}),
      ...(failed.length ? { errorCode: failed[0].errorCode, lastError: failed[0].error } : {}),
    });
    return { status, insertedCount: write.insertedCount };
  },
});

// Deletion-only maintenance stays available while collection is not approved.
export const pruneExpired = internalMutationGeneric({
  args: { stationIcao: v.optional(v.string()) },
  handler: async (ctx, args) => {
    airportOnly(args.stationIcao);
    return { prunedCount: await prune(ctx, Date.now()) };
  },
});

const cadenceRank = (row) => (row.collectionCadence === "one_minute" ? 2 : row.collectionCadence === "five_minute" ? 1 : 0);

// AMOS needs no approval, so the airport's own reading shows whatever the station
// gate says. It follows the chart's rule: the newest minute with a temperature,
// one-minute rows over five-minute, then the newer revision, because a five-minute
// row can lack a temperature or hold an older value for the same minute. With no
// temperature at all the newest row is used, so the card can say so. The first
// minute of a day falls back to the day before.
async function latestAmos(ctx, stationIcao, date, { rwyNo, rwyDir }) {
  const newestOn = (day) => ctx.db.query("seoulAmosObservations")
    .withIndex("by_station_date_rwy_ts", (q) => q.eq("stationIcao", stationIcao).eq("date", day).eq("rwyNo", rwyNo).eq("rwyDir", rwyDir))
    .order("desc").take(AMOS_ROWS_READ);
  const onDate = await newestOn(date);
  const rows = onDate.length ? onDate : await newestOn(shiftDate(date, -1));
  const withTemperature = rows.filter((candidate) => Number.isFinite(candidate.tempC));
  const row = [...(withTemperature.length ? withTemperature : rows)]
    .sort((a, b) => b.obsTimeUtc - a.obsTimeUtc || cadenceRank(b) - cadenceRank(a) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
  if (!row) return null;
  return {
    rwyDir, obsTimeUtc: row.obsTimeUtc,
    ...(Number.isFinite(row.tempC) ? { tempC: row.tempC } : {}),
    ...(Number.isFinite(row.windDirAvg) ? { windDirDeg: row.windDirAvg } : {}),
    ...(Number.isFinite(row.windSpeedAvg) ? { windSpeedKt: row.windSpeedAvg } : {}),
  };
}

// No upper time bound: the subscription must wake for any newer row, however
// long ago this query last ran. Rows from a source that is no longer approved stay
// hidden, so a switch of source can show nothing until the new source has a row.
async function latestStationReading(ctx, stationId, now, approvedSources) {
  const rows = await ctx.db.query("seoulNearbyStationObservations")
    .withIndex("by_station_obs_ts", (q) => q.eq("stationId", stationId)).order("desc").take(STATION_ROWS_READ);
  const row = rows.find((candidate) => approvedSources.includes(candidate.source));
  if (!row || now - row.obsTimeUtc > NEARBY_RETENTION_MS) return null;
  return {
    obsTimeUtc: row.obsTimeUtc, firstSeenAt: row.firstSeenAt,
    ...(Number.isFinite(row.tempC) ? { tempC: row.tempC } : {}),
    ...(Number.isFinite(row.windDirDeg) ? { windDirDeg: row.windDirDeg } : {}),
    ...(row.windDirCompass ? { windDirCompass: row.windDirCompass } : {}),
    ...(Number.isFinite(row.windSpeedMs) ? { windSpeedMs: row.windSpeedMs } : {}),
  };
}

/**
 * Today's panel. Protected tables are not read unless a source's approval flag is
 * exactly "true"; revoking it hides that source's readings at this boundary too. It
 * makes no external request and the browser never sees the key or a raw error.
 */
export const getDashboard = queryGeneric({
  args: { stationIcao: v.optional(v.string()), date: v.string() },
  handler: async (ctx, args) => {
    const stationIcao = airportOnly(args.stationIcao);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) throw new Error("Date must be in YYYY-MM-DD format.");
    const now = Date.now(), today = kstDate(now), { approved, configured, source, approvedSources } = access();
    const empty = {
      stationIcao, date: args.date, today, approved, configured, source: null,
      airport: { icao: AIRPORT.icao, name: AIRPORT.name, elevationM: AIRPORT.elevationM, reference: null, comparison: null },
      stations: nearbyStationsWithGeometry().map((station) => ({ ...station, reading: null })),
      collector: null,
    };
    // Read before the date check, though another date returns none of it: a device
    // clock that reaches tomorrow first subscribes early, and only a read here lets
    // the next AMOS row wake that subscription.
    const [reference, comparison] = await Promise.all([
      latestAmos(ctx, stationIcao, args.date, RUNWAYS.reference), latestAmos(ctx, stationIcao, args.date, RUNWAYS.comparison),
    ]);
    if (args.date !== today) return { ...empty, status: "not_today" };
    const airport = { ...empty.airport, reference, comparison };
    if (!approved) return { ...empty, airport, status: "approval_required" };
    const [collector, readings] = await Promise.all([
      collectorState(ctx, stationIcao),
      Promise.all(empty.stations.map((station) => latestStationReading(ctx, station.id, now, approvedSources))),
    ]);
    const stations = empty.stations.map((station, index) => ({ ...station, reading: readings[index] }));
    const lastRun = collector?.status;
    const status = !configured ? "setup_required"
      : lastRun === "error" ? "error"
      : !readings.some(Boolean) ? "building"
      : lastRun === "partial" ? "partial" : "ok";
    return {
      ...empty, airport, stations, status, source,
      collector: collector ? {
        status: collector.status, lastAttemptAt: collector.lastAttemptAt ?? null, lastSuccessAt: collector.lastSuccessAt ?? null, errorCode: collector.errorCode ?? null,
      } : null,
    };
  },
});
