import { internalActionGeneric, internalMutationGeneric, internalQueryGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api.js";
import {
  DAY_HOURS, LOCK_HOUR, MAX_CAPTURE_AGE_MS, OPEN_METEO_APPROVAL_FLAG, OPEN_METEO_HOURLY, OPEN_METEO_PROVIDERS, PROVIDERS,
  PROVIDER_FORECAST_VERSION, RKSI_POINT, buildActuals, dateRange, forecastPeak, hourTime, isProviderApproved, isValidDate,
  kmaLockRows, kstDate, lockStatus, lockTime, openMeteoLockRows, pickAmosRow, providerById, scoreLock, shiftDate,
  summarizeScores, weathercomLockRows,
} from "./lib/seoulProviderForecastModel.js";
import { providerForecastHour, providerForecastProvider } from "./lib/seoulProviderForecastSchema.js";

const MINUTE = 60_000;
// Scheduled attempts run at 09:00, 09:05, 09:10 and 09:15 KST.
const LOCK_WINDOW_MS = 20 * MINUTE;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_RANGE_DAYS = 31;
const compact = (row) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
const message = (error) => String(error instanceof Error ? error.message : error).slice(0, 300);
const approvals = () => Object.fromEntries(PROVIDERS.map((provider) => [provider.id, isProviderApproved(provider, process.env)]));
const openMeteoApproved = () => process.env[OPEN_METEO_APPROVAL_FLAG] === "true";

function assertDate(date) {
  if (!isValidDate(date)) throw new Error("Date must be a valid YYYY-MM-DD date");
}
function assertRange(startDate, endDate) {
  assertDate(startDate);
  assertDate(endDate);
  if (endDate < startDate) throw new Error("endDate must not be before startDate");
  if (dateRange(startDate, endDate).length > MAX_RANGE_DAYS) throw new Error(`At most ${MAX_RANGE_DAYS} days per call`);
}

async function locksFor(ctx, date) {
  return await ctx.db.query("seoulProviderForecastLocks")
    .withIndex("by_station_date_provider", (q) => q.eq("stationIcao", "RKSI").eq("date", date)).take(10);
}

// A usable lock is never replaced. An error record may be replaced by a later
// attempt; a repeated error only updates its message.
async function saveLock(ctx, fields) {
  const existing = (await locksFor(ctx, fields.date)).find((row) => row.provider === fields.provider);
  if (existing && existing.status !== "error") return { status: "duplicate", lockId: existing._id };
  if (existing && fields.status === "error") {
    await ctx.db.patch(existing._id, { error: fields.error, lockedAt: fields.lockedAt });
    return { status: "error", lockId: existing._id };
  }
  if (existing) {
    await ctx.db.replace(existing._id, fields);
    return { status: fields.status, lockId: existing._id };
  }
  return { status: fields.status, lockId: await ctx.db.insert("seoulProviderForecastLocks", fields) };
}

function lockFields({ date, provider, method, now, rows, ...rest }) {
  const peak = forecastPeak(rows);
  return compact({
    stationIcao: "RKSI", date, provider, status: rows.length ? lockStatus(rows) : "error", method, version: PROVIDER_FORECAST_VERSION,
    lockAt: lockTime(date), lockedAt: now, hourly: rows, highC: peak?.highC, peakHours: peak?.hours, ...rest,
  });
}

// The newest stored capture that had completed by 09:00 KST and has rows for
// the date. KMA hours are never merged across captures.
const CAPTURE_SOURCES = {
  kma: {
    label: "KMA",
    read: (ctx, lockAt) => ctx.db.query("seoulKmaForecastCaptures")
      .withIndex("by_station_status_capturedAt", (q) => q.eq("stationIcao", "RKSI").eq("status", "ok")
        .gte("capturedAt", lockAt - MAX_CAPTURE_AGE_MS).lte("capturedAt", lockAt))
      .order("desc").take(40),
    receivedAt: (capture) => (capture.source === "kma_amo_airport" ? capture.createdAt ?? capture._creationTime : null),
    rows: kmaLockRows,
  },
  weathercom: {
    label: "Weather.com",
    read: (ctx, lockAt) => ctx.db.query("seoulForecastCaptures")
      .withIndex("by_station_capturedAt", (q) => q.eq("stationIcao", "RKSI")
        .gte("capturedAt", lockAt - MAX_CAPTURE_AGE_MS).lte("capturedAt", lockAt))
      .order("desc").take(40),
    receivedAt: (capture) => (capture.weathercomHourlyStatus === "ok" ? capture.weathercomHourlyCapturedAt ?? null : null),
    rows: weathercomLockRows,
  },
};

async function lockFromCaptures(ctx, { provider, date, now, recordMissing }) {
  const existing = (await locksFor(ctx, date)).find((row) => row.provider === provider);
  if (existing && existing.status !== "error") return "duplicate";
  const source = CAPTURE_SOURCES[provider], lockAt = lockTime(date);
  for (const capture of await source.read(ctx, lockAt)) {
    const receivedAt = source.receivedAt(capture);
    if (!Number.isFinite(receivedAt) || receivedAt > lockAt) continue;
    const rows = source.rows(capture, date);
    if (!rows.length) continue;
    return (await saveLock(ctx, lockFields({
      date, provider, method: "stored_capture", now, rows, capturedAt: capture.capturedAt, receivedAt, sourceCaptureId: String(capture._id),
    }))).status;
  }
  if (!recordMissing) return "missing";
  return (await saveLock(ctx, lockFields({
    date, provider, method: "stored_capture", now, rows: [],
    error: `No ${source.label} forecast capture completed in the 6 hours before 9:00 AM KST.`,
  }))).status;
}

/**
 * Locks KMA and Weather.com for a date from stored captures. The selection only
 * depends on what had been stored by 09:00 KST, so a later run for a past date
 * reproduces the same lock. KMA is skipped without reading when not approved.
 */
export const lockStoredForecasts = internalMutationGeneric({
  args: { date: v.string(), recordMissing: v.optional(v.boolean()) },
  handler: async (ctx, { date, recordMissing = false }) => {
    assertDate(date);
    const now = Date.now();
    if (now < lockTime(date)) return { status: "too_early" };
    const access = approvals();
    return {
      kma: access.kma ? await lockFromCaptures(ctx, { provider: "kma", date, now, recordMissing }) : "approval_required",
      weathercom: await lockFromCaptures(ctx, { provider: "weathercom", date, now, recordMissing }),
    };
  },
});

export const lockStatuses = internalQueryGeneric({
  args: { date: v.string() },
  handler: async (ctx, { date }) => Object.fromEntries((await locksFor(ctx, date)).map((row) => [row.provider, row.status])),
});

// A running action can keep the environment it started with, so it reads the
// Open-Meteo flag through this query before every request.
export const openMeteoAccess = internalQueryGeneric({ args: {}, handler: async () => openMeteoApproved() });

/** Saves one Open-Meteo model lock. The approval flag is checked again here, after the request. */
export const storeModelLock = internalMutationGeneric({
  args: {
    date: v.string(), provider: providerForecastProvider, method: v.union(v.literal("live_fetch"), v.literal("single_run_archive")),
    status: v.union(v.literal("ok"), v.literal("partial"), v.literal("error")), modelId: v.string(),
    receivedAt: v.optional(v.number()), requestUrl: v.optional(v.string()),
    runInitAt: v.optional(v.number()), runAvailableAt: v.optional(v.number()),
    runCheck: v.optional(v.union(v.literal("stable"), v.literal("changed"), v.literal("unknown"))),
    gridLatitude: v.optional(v.number()), gridLongitude: v.optional(v.number()), gridElevationM: v.optional(v.number()),
    hourly: v.array(providerForecastHour), error: v.optional(v.string()), issues: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { hourly, status, ...args }) => {
    assertDate(args.date);
    if (!openMeteoApproved()) return { status: "approval_required" };
    if (providerById(args.provider)?.kind !== "open_meteo") throw new Error("Not an Open-Meteo provider");
    const now = Date.now(), lockAt = lockTime(args.date);
    if (args.method === "live_fetch" && (now < lockAt || now - lockAt > LOCK_WINDOW_MS + 5 * MINUTE)) return { status: "outside_window" };
    if (args.method === "single_run_archive" && (!Number.isFinite(args.runInitAt) || now - lockAt <= LOCK_WINDOW_MS)) {
      throw new Error("An archived run needs its run time and a date whose lock window has passed");
    }
    const fields = lockFields({ ...args, now, rows: status === "error" ? [] : hourly });
    return await saveLock(ctx, status === "error" ? { ...fields, status: "error" } : fields);
  },
});

async function openMeteoJson(host, path, params) {
  const key = process.env.OPEN_METEO_API_KEY;
  const url = new URL(`https://${key ? `customer-${host}` : host}${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
  const shown = url.toString();
  if (key) url.searchParams.set("apikey", key);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" }, signal: controller.signal });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Open-Meteo ${response.status}: ${String(body?.reason ?? "request failed").slice(0, 200)}`);
    return { body, url: shown };
  } finally {
    clearTimeout(timer);
  }
}

// Open-Meteo's forecast response does not name its model run; the domain
// metadata gives the newest run the API serves. Read before and after.
async function latestRun(provider) {
  try {
    const { body } = await openMeteoJson("api.open-meteo.com", `/data/${provider.metaDomain}/static/meta.json`, {});
    const initAt = body?.last_run_initialisation_time * 1000, availableAt = body?.last_run_availability_time * 1000;
    return Number.isFinite(initAt) ? { initAt, availableAt: Number.isFinite(availableAt) ? availableAt : undefined } : null;
  } catch {
    return null;
  }
}

const forecastParams = (provider, extra) => ({
  latitude: RKSI_POINT.latitude, longitude: RKSI_POINT.longitude, models: provider.model, hourly: OPEN_METEO_HOURLY,
  timezone: "Asia/Seoul", timeformat: "unixtime", ...extra,
});

const runName = (time) => `${new Date(time).toISOString().slice(0, 13).replace("T", " ")}Z`;

// Returns null once approval is withdrawn; `approved` is checked before every
// request. A run published after 9:00 AM KST was not the forecast at the lock,
// so it is refused rather than stored as the 9 AM forecast.
async function fetchLiveModel(provider, date, approved) {
  const base = { date, provider: provider.id, method: "live_fetch", modelId: provider.model };
  const lateRun = (run) => Number.isFinite(run?.availableAt) && run.availableAt > lockTime(date);
  const refuse = (run) => ({ ...base, status: "error", hourly: [],
    error: `The newest run (${runName(run.initAt)}) was published after 9:00 AM KST, so the 9 AM forecast is no longer served.` });
  try {
    if (!(await approved())) return null;
    const before = await latestRun(provider);
    if (lateRun(before)) return refuse(before);
    if (!(await approved())) return null;
    const { body, url } = await openMeteoJson("api.open-meteo.com", "/v1/forecast", forecastParams(provider, { start_date: date, end_date: date }));
    const receivedAt = Date.now();
    if (!(await approved())) return null;
    const after = await latestRun(provider);
    if (lateRun(after)) return refuse(after);
    const { rows, issues, grid } = openMeteoLockRows(body, date);
    const runCheck = before && after ? (before.initAt === after.initAt ? "stable" : "changed") : "unknown";
    const run = runCheck === "changed" ? null : after ?? before;
    if (runCheck === "changed") issues.push("The model run changed during the request.");
    if (run?.availableAt && receivedAt - run.availableAt < 10 * MINUTE) issues.push("The run became available less than 10 minutes before the request.");
    return compact({
      ...base, status: lockStatus(rows), receivedAt, requestUrl: url, runInitAt: run?.initAt, runAvailableAt: run?.availableAt, runCheck,
      ...grid, hourly: rows, issues: issues.length ? issues : undefined,
    });
  } catch (error) {
    return { ...base, status: "error", hourly: [], error: message(error) };
  }
}

// The run that is normally current at 09:00 KST: the previous day's 12Z for
// ECMWF and 18Z for GFS and ICON, fetched from Open-Meteo's run archive.
async function fetchArchivedModel(provider, date, approved) {
  const runInitAt = Date.parse(`${shiftDate(date, -1)}T${String(provider.archiveRunHourUtc).padStart(2, "0")}:00:00Z`);
  const base = { date, provider: provider.id, method: "single_run_archive", modelId: provider.model, runInitAt };
  try {
    if (!(await approved())) return null;
    const run = new Date(runInitAt).toISOString().slice(0, 16);
    const { body, url } = await openMeteoJson("single-runs-api.open-meteo.com", "/v1/forecast", forecastParams(provider, { run, forecast_days: 2 }));
    const { rows, issues, grid } = openMeteoLockRows(body, date);
    return compact({ ...base, status: lockStatus(rows), receivedAt: Date.now(), requestUrl: url, ...grid, hourly: rows, issues: issues.length ? issues : undefined });
  } catch (error) {
    return { ...base, status: "error", hourly: [], error: message(error) };
  }
}

// Removing the flag stops the remaining work: the fresh check before each
// request, or the store mutation's own check, ends the loop.
async function lockModels(ctx, date, fetchModel, inWindow) {
  const approved = async () => (await ctx.runQuery(internal.seoulProviderForecasts.openMeteoAccess, {})) === true;
  if (!(await approved())) return { status: "approval_required" };
  const statuses = await ctx.runQuery(internal.seoulProviderForecasts.lockStatuses, { date });
  const results = {};
  let revoked = false;
  for (const provider of OPEN_METEO_PROVIDERS) {
    if (statuses[provider.id] && statuses[provider.id] !== "error") { results[provider.id] = "duplicate"; continue; }
    if (revoked) { results[provider.id] = "approval_required"; continue; }
    if (!inWindow()) { results[provider.id] = "outside_window"; continue; }
    const fetched = await fetchModel(provider, date, approved);
    results[provider.id] = fetched ? (await ctx.runMutation(internal.seoulProviderForecasts.storeModelLock, fetched)).status : "approval_required";
    revoked = results[provider.id] === "approval_required";
  }
  return results;
}

/** Cron entry at 00:00, 00:05, 00:10 and 00:15 UTC (09:00-09:15 KST). */
export const runScheduledLock = internalActionGeneric({
  args: {},
  handler: async (ctx) => {
    const now = Date.now(), date = kstDate(now), lockAt = lockTime(date);
    if (now < lockAt || now - lockAt > LOCK_WINDOW_MS) return { status: "outside_window" };
    const stored = await ctx.runMutation(internal.seoulProviderForecasts.lockStoredForecasts, { date, recordMissing: true });
    const models = await lockModels(ctx, date, fetchLiveModel, () => Date.now() - lockAt <= LOCK_WINDOW_MS);
    return { status: "ran", date, stored, models };
  },
});

/** Rebuilds KMA and Weather.com locks for past dates from stored captures. */
export const backfillStoredForecasts = internalActionGeneric({
  args: { startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { startDate, endDate }) => {
    assertRange(startDate, endDate);
    const results = [];
    for (const date of dateRange(startDate, endDate)) {
      if (Date.now() < lockTime(date)) break;
      results.push({ date, ...(await ctx.runMutation(internal.seoulProviderForecasts.lockStoredForecasts, { date })) });
    }
    return results;
  },
});

/** Rebuilds missing model locks for days whose lock window has passed, from the run archive. Gated. */
export const backfillModelLocks = internalActionGeneric({
  args: { startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { startDate, endDate }) => {
    assertRange(startDate, endDate);
    if (!openMeteoApproved()) return { status: "approval_required" };
    const results = [];
    for (const date of dateRange(startDate, endDate)) {
      if (Date.now() - lockTime(date) <= LOCK_WINDOW_MS) break;
      const result = await lockModels(ctx, date, fetchArchivedModel, () => true);
      results.push({ date, ...result });
      if (Object.values(result).includes("approval_required")) return { status: "approval_required", results };
    }
    return { status: "ran", results };
  },
});

async function loadActuals(ctx, date) {
  const amosByHour = await Promise.all(DAY_HOURS.map(async (hour) => pickAmosRow(await ctx.db.query("seoulAmosObservations")
    .withIndex("by_station_date_rwy_ts", (q) => q.eq("stationIcao", "RKSI").eq("date", date).eq("rwyNo", "2").eq("rwyDir", "15L")
      .eq("obsTimeUtc", hourTime(date, hour)))
    .take(4))));
  const metarRows = await ctx.db.query("seoulMetarObservations")
    .withIndex("by_station_date_ts", (q) => q.eq("stationIcao", "RKSI").eq("date", date)).take(200);
  return buildActuals({ date, amosByHour, metarRows });
}

/**
 * Runs after KST midnight; scores each approved lock once against its day's
 * observed record. Pass a range to score backfilled days (up to yesterday).
 */
export const scoreCompletedDays = internalMutationGeneric({
  args: { startDate: v.optional(v.string()), endDate: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now(), yesterday = shiftDate(kstDate(now), -1);
    const endDate = args.endDate && args.endDate < yesterday ? args.endDate : yesterday;
    const startDate = args.startDate ?? shiftDate(endDate, -6);
    assertRange(startDate, endDate);
    const access = approvals();
    const locks = (await ctx.db.query("seoulProviderForecastLocks")
      .withIndex("by_station_date_provider", (q) => q.eq("stationIcao", "RKSI").gte("date", startDate).lte("date", endDate)).take(200))
      .filter((lock) => lock.status !== "error" && access[lock.provider]);
    const actualsByDate = new Map();
    let scored = 0, missing = 0;
    for (const lock of locks) {
      if (await ctx.db.query("seoulProviderForecastScores").withIndex("by_lock", (q) => q.eq("lockId", lock._id)).first()) continue;
      if (!actualsByDate.has(lock.date)) actualsByDate.set(lock.date, await loadActuals(ctx, lock.date));
      const actuals = actualsByDate.get(lock.date);
      const score = scoreLock(lock, actuals);
      const status = score.hoursScored || score.highComplete ? "scored" : "missing";
      await ctx.db.insert("seoulProviderForecastScores", compact({
        lockId: lock._id, stationIcao: "RKSI", date: lock.date, provider: lock.provider, method: lock.method, version: PROVIDER_FORECAST_VERSION,
        scoredAt: now, status, hoursScored: score.hoursScored, sumAbsErrorC: score.sumAbsErrorC, sumErrorC: score.sumErrorC,
        maeC: score.maeC ?? undefined, biasC: score.biasC ?? undefined, forecastHighC: score.forecastHighC ?? undefined,
        forecastHighRoundedC: score.forecastHighRoundedC ?? undefined, forecastPeakHours: score.forecastPeakHours,
        actualHighC: score.actualHighC ?? undefined, actualHighTime: score.actualHighTime ?? undefined, highComplete: score.highComplete,
        highErrorC: score.highComplete ? score.highErrorC ?? undefined : undefined,
        peakErrorMinutes: score.highComplete ? score.peakErrorMinutes ?? undefined : undefined,
        afterLockReportCount: actuals.afterLockReportCount, pairs: score.pairs,
      }));
      if (status === "scored") scored += 1; else missing += 1;
    }
    return { startDate, endDate, scored, missing };
  },
});

/**
 * Locked forecasts, the observed hourly record and live scores for one date,
 * plus stored results for the 30 days ending on it. Providers that are not
 * approved come back as approval_required without any of their data.
 */
export const getDashboard = queryGeneric({
  args: { stationIcao: v.literal("RKSI"), date: v.string() },
  handler: async (ctx, { date }) => {
    assertDate(date);
    const access = approvals();
    const locks = await locksFor(ctx, date);
    const actuals = await loadActuals(ctx, date);
    const providers = PROVIDERS.map((provider) => {
      const base = { id: provider.id, label: provider.label, shortLabel: provider.shortLabel, kind: provider.kind };
      if (!access[provider.id]) return { ...base, access: "approval_required", approvalFlag: provider.approvalFlag, lock: null, score: null };
      const lock = locks.find((row) => row.provider === provider.id);
      if (!lock) return { ...base, access: "approved", lock: null, score: null };
      const { _id, _creationTime, stationIcao, sourceCaptureId, requestUrl, ...shown } = lock;
      if (lock.status === "error") return { ...base, access: "approved", lock: shown, score: null };
      const { pairs, ...score } = scoreLock(lock, actuals);
      return { ...base, access: "approved", lock: shown, score };
    });
    const summaryStartDate = shiftDate(date, -29);
    const scores = (await ctx.db.query("seoulProviderForecastScores")
      .withIndex("by_station_date", (q) => q.eq("stationIcao", "RKSI").gte("date", summaryStartDate).lte("date", date)).take(300))
      .filter((row) => access[row.provider]);
    return {
      stationIcao: "RKSI", date, version: PROVIDER_FORECAST_VERSION, lockHour: LOCK_HOUR, lockAt: lockTime(date),
      providers, actuals, summary: summarizeScores(scores), summaryStartDate, summaryEndDate: date,
      summaryDayCount: new Set(scores.filter((row) => row.status === "scored").map((row) => row.date)).size,
    };
  },
});
