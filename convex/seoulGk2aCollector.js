import {
  internalActionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  mutationGeneric,
} from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

const SEOUL_TIMEZONE = "Asia/Seoul";
const RKSI_STATION_ICAO = "RKSI";
const RKSI_LATITUDE = 37.4602;
const RKSI_LONGITUDE = 126.4407;
const MILLIS_PER_MINUTE = 60 * 1000;
const PRODUCT_CADENCE_MINUTES = 10;
const COLLECTION_LOCK_TIMEOUT_MS = 15 * 60 * 1000;
const COLLECTION_SLOT_MS = 10 * 60 * 1000;
const OBSERVATION_RETENTION_MS = 48 * 60 * 60 * 1000;
const MAX_RECENT_WIND_AGE_MINUTES = 45;
const MIN_UPWIND_WIND_SPEED_KT = 2;
const TRANSMISSION_MIN_CLEAR_SKY_WM2 = 50;
const TRANSMISSION_MAX_PCT = 200;
const UPWIND_HORIZONS_MINUTES = [20, 40, 60];
const KMA_SOURCE = "kma_nmsc_gk2a_swrad";
const KMA_SOURCE_ENDPOINT = "selectImgDown.do";

const COLLECTOR_STATUS = {
  OK: "ok",
  PARTIAL: "partial",
  NO_DATA: "no_data",
  ERROR: "error",
  UNCONFIGURED: "unconfigured",
};

const POINT_KIND = {
  AIRPORT: "airport",
  UPWIND_20M: "upwind_20m",
  UPWIND_40M: "upwind_40m",
  UPWIND_60M: "upwind_60m",
};

const pointKindByHorizon = new Map([
  [20, POINT_KIND.UPWIND_20M],
  [40, POINT_KIND.UPWIND_40M],
  [60, POINT_KIND.UPWIND_60M],
]);

const seoulDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEOUL_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const seoulDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEOUL_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  hourCycle: "h23",
});

const pointKindValidator = v.union(
  v.literal(POINT_KIND.AIRPORT),
  v.literal(POINT_KIND.UPWIND_20M),
  v.literal(POINT_KIND.UPWIND_40M),
  v.literal(POINT_KIND.UPWIND_60M),
);

const collectorStatusValidator = v.union(
  v.literal("ok"),
  v.literal("partial"),
  v.literal("no_data"),
  v.literal("error"),
  v.literal("unconfigured"),
);

const collectionModeValidator = v.union(
  v.literal("manual"),
  v.literal("scheduled"),
);

const solarObservationValidator = v.object({
  stationIcao: v.string(),
  date: v.string(),
  obsTimeUtc: v.number(),
  obsTimeLocal: v.string(),
  pointKind: pointKindValidator,
  sampleKey: v.string(),
  latitude: v.number(),
  longitude: v.number(),
  sourceLatitude: v.optional(v.number()),
  sourceLongitude: v.optional(v.number()),
  upwindMinutes: v.optional(v.number()),
  distanceUpwindKm: v.optional(v.number()),
  dsrWm2: v.optional(v.number()),
  asrWm2: v.optional(v.number()),
  clearSkyDsrWm2: v.number(),
  solarElevationDeg: v.number(),
  transmissionPct: v.optional(v.number()),
  windObservedAtUtc: v.optional(v.number()),
  windDirectionFromDeg: v.optional(v.number()),
  windSpeedKt: v.optional(v.number()),
  windSpeedMps: v.optional(v.number()),
  source: v.string(),
  sourceEndpoint: v.string(),
  sourceFileName: v.string(),
  sourceGridRow: v.number(),
  sourceGridColumn: v.number(),
  dsrQualityFlag: v.number(),
  asrQualityFlag: v.number(),
  shortwaveQualityFlag: v.number(),
  productCadenceMinutes: v.number(),
  collectionRunAt: v.number(),
});

function getDateParts(formatter, date) {
  const values = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return values;
}

function formatSeoulDate(epochMs) {
  const parts = getDateParts(seoulDateFormatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatSeoulDateTime(epochMs) {
  const parts = getDateParts(seoulDateTimeFormatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function hasUsefulSolarEnergy(epochMs) {
  return (
    haurwitzClearSkyDsr(epochMs, RKSI_LATITUDE, RKSI_LONGITUDE)
      .clearSkyDsrWm2 >= TRANSMISSION_MIN_CLEAR_SKY_WM2
  );
}

function normalizeStationIcao(value) {
  const stationIcao = String(value ?? RKSI_STATION_ICAO)
    .trim()
    .toUpperCase();
  if (stationIcao !== RKSI_STATION_ICAO) {
    throw new Error("The GK2A solar collector currently supports RKSI only.");
  }
  return stationIcao;
}

function hasApprovedNmscAccess() {
  return process.env.NMSC_GK2A_ACCESS_APPROVED === "true";
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function formatErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 500);
}

function degreesToRadians(value) {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value) {
  return (value * 180) / Math.PI;
}

function dayOfYearUtc(epochMs) {
  const date = new Date(epochMs);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((epochMs - yearStart) / (24 * 60 * 60 * 1000)) + 1;
}

function solarPosition(epochMs, latitude, longitude) {
  const date = new Date(epochMs);
  const year = date.getUTCFullYear();
  const daysInYear =
    Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1) > 365 * 24 * 60 * 60 * 1000
      ? 366
      : 365;
  const utcHour =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600;
  const fractionalYear =
    ((2 * Math.PI) / daysInYear) *
    (dayOfYearUtc(epochMs) - 1 + (utcHour - 12) / 24);
  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(fractionalYear) -
      0.032077 * Math.sin(fractionalYear) -
      0.014615 * Math.cos(2 * fractionalYear) -
      0.040849 * Math.sin(2 * fractionalYear));
  const declination =
    0.006918 -
    0.399912 * Math.cos(fractionalYear) +
    0.070257 * Math.sin(fractionalYear) -
    0.006758 * Math.cos(2 * fractionalYear) +
    0.000907 * Math.sin(2 * fractionalYear) -
    0.002697 * Math.cos(3 * fractionalYear) +
    0.00148 * Math.sin(3 * fractionalYear);
  const utcMinutes =
    date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarMinutes =
    (((utcMinutes + equationOfTime + 4 * longitude) % 1440) + 1440) % 1440;
  const hourAngleDegrees =
    trueSolarMinutes / 4 < 0
      ? trueSolarMinutes / 4 + 180
      : trueSolarMinutes / 4 - 180;
  const latitudeRadians = degreesToRadians(latitude);
  const hourAngle = degreesToRadians(hourAngleDegrees);
  const cosineZenith = clamp(
    Math.sin(latitudeRadians) * Math.sin(declination) +
      Math.cos(latitudeRadians) * Math.cos(declination) * Math.cos(hourAngle),
    -1,
    1,
  );
  return {
    cosineZenith,
    solarElevationDeg: radiansToDegrees(Math.asin(cosineZenith)),
  };
}

function haurwitzClearSkyDsr(epochMs, latitude, longitude) {
  const position = solarPosition(epochMs, latitude, longitude);
  const clearSkyDsrWm2 =
    position.cosineZenith > 0
      ? 1098 * position.cosineZenith * Math.exp(-0.059 / position.cosineZenith)
      : 0;
  return {
    solarElevationDeg: round(position.solarElevationDeg, 2),
    clearSkyDsrWm2: round(Math.max(0, clearSkyDsrWm2), 1),
  };
}

function destinationPoint(latitude, longitude, bearingDegrees, distanceKm) {
  const earthRadiusKm = 6371.0088;
  const angularDistance = distanceKm / earthRadiusKm;
  const bearing = degreesToRadians(bearingDegrees);
  const latitudeRadians = degreesToRadians(latitude);
  const longitudeRadians = degreesToRadians(longitude);
  const destinationLatitude = Math.asin(
    Math.sin(latitudeRadians) * Math.cos(angularDistance) +
      Math.cos(latitudeRadians) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const destinationLongitude =
    longitudeRadians +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitudeRadians),
      Math.cos(angularDistance) -
        Math.sin(latitudeRadians) * Math.sin(destinationLatitude),
    );
  return {
    latitude: round(radiansToDegrees(destinationLatitude), 6),
    longitude: round(
      ((radiansToDegrees(destinationLongitude) + 540) % 360) - 180,
      6,
    ),
  };
}

function buildSamplingPoints(wind, collectionRunAt) {
  const airport = {
    pointKind: POINT_KIND.AIRPORT,
    sampleKey: POINT_KIND.AIRPORT,
    latitude: RKSI_LATITUDE,
    longitude: RKSI_LONGITUDE,
  };
  if (!wind) {
    return {
      points: [airport],
      upwindStatus: "unavailable",
      upwindReason: "No recent representative AMOS wind is stored.",
    };
  }
  if (wind.ageMinutes > MAX_RECENT_WIND_AGE_MINUTES) {
    return {
      points: [airport],
      upwindStatus: "unavailable",
      upwindReason: "The latest representative AMOS wind is stale.",
      wind,
    };
  }
  if (wind.windSpeedKt < MIN_UPWIND_WIND_SPEED_KT) {
    return {
      points: [airport],
      upwindStatus: "calm",
      upwindReason: `Wind below ${MIN_UPWIND_WIND_SPEED_KT} kt does not define a useful upwind corridor.`,
      wind,
    };
  }

  const upwindPoints = UPWIND_HORIZONS_MINUTES.map((upwindMinutes) => {
    const distanceUpwindKm = Math.min(
      120,
      (wind.windSpeedKt * 1.852 * upwindMinutes) / 60,
    );
    return {
      pointKind: pointKindByHorizon.get(upwindMinutes),
      sampleKey: `${pointKindByHorizon.get(upwindMinutes)}:${collectionRunAt}`,
      ...destinationPoint(
        RKSI_LATITUDE,
        RKSI_LONGITUDE,
        wind.windDirectionFromDeg,
        distanceUpwindKm,
      ),
      upwindMinutes,
      distanceUpwindKm: round(distanceUpwindKm, 2),
    };
  }).filter(
    (point) =>
      point.latitude >= 33 &&
      point.latitude <= 43 &&
      point.longitude >= 124 &&
      point.longitude <= 132,
  );

  return {
    points: [airport, ...upwindPoints],
    upwindStatus: upwindPoints.length === 3 ? "available" : "partial",
    upwindReason:
      upwindPoints.length === 3
        ? null
        : "One or more wind-projected points fell outside the GK2A Korea grid.",
    wind,
  };
}

function buildObservationRows(result, sampling) {
  return result.samples
    .filter(
      (sample) =>
        !sample.error &&
        (Number.isFinite(sample.dsrWm2) || Number.isFinite(sample.asrWm2)),
    )
    .map((sample) => {
      const clearSky = haurwitzClearSkyDsr(
        result.observationTimeUtc,
        sample.latitude,
        sample.longitude,
      );
      const rawTransmissionPct =
        Number.isFinite(sample.dsrWm2) &&
        clearSky.clearSkyDsrWm2 >= TRANSMISSION_MIN_CLEAR_SKY_WM2
          ? (sample.dsrWm2 / clearSky.clearSkyDsrWm2) * 100
          : null;
      const transmissionPct =
        Number.isFinite(rawTransmissionPct) &&
        rawTransmissionPct >= 0 &&
        rawTransmissionPct <= TRANSMISSION_MAX_PCT
          ? round(rawTransmissionPct, 1)
          : null;
      const applicableWind =
        sampling.wind &&
        (sample.pointKind !== POINT_KIND.AIRPORT ||
          Math.abs(sampling.wind.obsTimeUtc - result.observationTimeUtc) <=
            30 * MILLIS_PER_MINUTE)
          ? sampling.wind
          : null;

      return {
        stationIcao: RKSI_STATION_ICAO,
        date: formatSeoulDate(result.observationTimeUtc),
        obsTimeUtc: result.observationTimeUtc,
        obsTimeLocal: formatSeoulDateTime(result.observationTimeUtc),
        pointKind: sample.pointKind,
        sampleKey:
          sample.pointKind === POINT_KIND.AIRPORT
            ? POINT_KIND.AIRPORT
            : `${sample.pointKind}:${result.observationTimeUtc}`,
        latitude: sample.latitude,
        longitude: sample.longitude,
        sourceLatitude: sample.sourceLatitude,
        sourceLongitude: sample.sourceLongitude,
        ...(Number.isFinite(sample.upwindMinutes)
          ? { upwindMinutes: sample.upwindMinutes }
          : {}),
        ...(Number.isFinite(sample.distanceUpwindKm)
          ? { distanceUpwindKm: sample.distanceUpwindKm }
          : {}),
        ...(Number.isFinite(sample.dsrWm2) ? { dsrWm2: sample.dsrWm2 } : {}),
        ...(Number.isFinite(sample.asrWm2) ? { asrWm2: sample.asrWm2 } : {}),
        clearSkyDsrWm2: clearSky.clearSkyDsrWm2,
        solarElevationDeg: clearSky.solarElevationDeg,
        ...(Number.isFinite(transmissionPct) ? { transmissionPct } : {}),
        ...(applicableWind
          ? {
              windObservedAtUtc: applicableWind.obsTimeUtc,
              windDirectionFromDeg: applicableWind.windDirectionFromDeg,
              windSpeedKt: applicableWind.windSpeedKt,
              windSpeedMps: applicableWind.windSpeedMps,
            }
          : {}),
        source: KMA_SOURCE,
        sourceEndpoint: KMA_SOURCE_ENDPOINT,
        sourceFileName: result.fileName,
        sourceGridRow: sample.row,
        sourceGridColumn: sample.column,
        dsrQualityFlag: sample.dsrQualityFlag,
        asrQualityFlag: sample.asrQualityFlag,
        shortwaveQualityFlag: sample.angleQualityFlag,
        productCadenceMinutes: PRODUCT_CADENCE_MINUTES,
        collectionRunAt: result.observationTimeUtc,
      };
    });
}

function observationChanged(existing, candidate) {
  return Object.entries(candidate).some(
    ([field, value]) =>
      field !== "stationIcao" &&
      field !== "date" &&
      field !== "obsTimeUtc" &&
      field !== "sampleKey" &&
      existing[field] !== value,
  );
}

async function queueCollection(ctx, { stationIcao, mode }) {
  const now = Date.now();
  if (!hasApprovedNmscAccess()) {
    return {
      queued: false,
      status: "access_not_approved",
      stationIcao,
    };
  }
  if (!hasUsefulSolarEnergy(now)) {
    return {
      queued: false,
      status: "outside_collection_window",
      stationIcao,
    };
  }

  const existing = await ctx.db
    .query("seoulGk2aCollectorStatus")
    .withIndex("by_station", (query) => query.eq("stationIcao", stationIcao))
    .first();
  if (
    Number.isFinite(existing?.collectionInFlightSince) &&
    now - existing.collectionInFlightSince < COLLECTION_LOCK_TIMEOUT_MS
  ) {
    return {
      queued: false,
      status: "already_running",
      stationIcao,
      collectionInFlightSince: existing.collectionInFlightSince,
    };
  }
  const collectionSlotUtc = Math.floor(now / COLLECTION_SLOT_MS);
  const existingCollectionSlotUtc = Number.isFinite(
    existing?.collectionQueuedAt,
  )
    ? Math.floor(existing.collectionQueuedAt / COLLECTION_SLOT_MS)
    : null;
  if (existingCollectionSlotUtc === collectionSlotUtc) {
    return {
      queued: false,
      status: "cooldown",
      stationIcao,
      retryAfterSeconds: Math.ceil(
        ((collectionSlotUtc + 1) * COLLECTION_SLOT_MS - now) / 1_000,
      ),
    };
  }

  const runId = `${mode}:${now}`;
  const patch = {
    stationIcao,
    status:
      existing?.status && existing.status !== "unconfigured"
        ? existing.status
        : COLLECTOR_STATUS.NO_DATA,
    configured: true,
    lastAttemptAt: now,
    lastAttemptAtLocal: formatSeoulDateTime(now),
    collectionQueuedAt: now,
    collectionInFlightSince: now,
    collectionMode: mode,
    collectionRunId: runId,
    updatedAt: now,
    ...(existing?.status === "unconfigured" ? { lastError: undefined } : {}),
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
  } else {
    await ctx.db.insert("seoulGk2aCollectorStatus", patch);
  }
  await ctx.scheduler.runAfter(
    0,
    internal.seoulGk2aCollector.collectSolarHeating,
    {
      stationIcao,
      requestedAt: now,
      mode,
      runId,
    },
  );
  return {
    queued: true,
    status: "queued",
    stationIcao,
    requestedAt: now,
    mode,
  };
}

export const requestSolarHeatingRefresh = mutationGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    await queueCollection(ctx, {
      stationIcao: normalizeStationIcao(args.stationIcao),
      mode: "manual",
    }),
});

export const queueScheduledSolarHeatingRefresh = internalMutationGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    await queueCollection(ctx, {
      stationIcao: normalizeStationIcao(args.stationIcao),
      mode: "scheduled",
    }),
});

export const getLatestAirportObservation = internalQueryGeneric({
  args: {
    stationIcao: v.string(),
  },
  handler: async (ctx, args) => {
    if (!hasApprovedNmscAccess()) {
      return null;
    }
    return await ctx.db
      .query("seoulGk2aSolarObservations")
      .withIndex("by_station_point_ts", (query) =>
        query
          .eq("stationIcao", args.stationIcao)
          .eq("pointKind", POINT_KIND.AIRPORT),
      )
      .order("desc")
      .first();
  },
});

export const getCollectorState = internalQueryGeneric({
  args: {
    stationIcao: v.string(),
  },
  handler: async (ctx, args) => {
    if (!hasApprovedNmscAccess()) {
      return null;
    }
    return await ctx.db
      .query("seoulGk2aCollectorStatus")
      .withIndex("by_station", (query) =>
        query.eq("stationIcao", args.stationIcao),
      )
      .first();
  },
});

async function pruneExpiredRows(ctx, stationIcao, retentionCutoffUtc) {
  const expiredRows = await ctx.db
    .query("seoulGk2aSolarObservations")
    .withIndex("by_station_obs_ts", (query) =>
      query.eq("stationIcao", stationIcao).lt("obsTimeUtc", retentionCutoffUtc),
    )
    .take(500);
  for (const row of expiredRows) {
    await ctx.db.delete(row._id);
  }
  return expiredRows.length;
}

export const upsertAndPruneSolarObservations = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    rows: v.array(solarObservationValidator),
    retentionCutoffUtc: v.number(),
  },
  handler: async (ctx, args) => {
    // This is the final database write boundary for downloaded NMSC rows.
    // A job that outlives approval must discard its payload, not persist it.
    if (!hasApprovedNmscAccess()) {
      return {
        status: "access_not_approved",
        insertedCount: 0,
        patchedCount: 0,
        unchangedCount: 0,
        prunedCount: 0,
        rowCount: 0,
      };
    }
    const now = Date.now();
    let insertedCount = 0;
    let patchedCount = 0;
    let unchangedCount = 0;

    for (const row of args.rows) {
      const existing = await ctx.db
        .query("seoulGk2aSolarObservations")
        .withIndex("by_station_date_sample_ts", (query) =>
          query
            .eq("stationIcao", row.stationIcao)
            .eq("date", row.date)
            .eq("sampleKey", row.sampleKey)
            .eq("obsTimeUtc", row.obsTimeUtc),
        )
        .first();
      if (!existing) {
        await ctx.db.insert("seoulGk2aSolarObservations", {
          ...row,
          firstSeenAt: now,
          updatedAt: now,
        });
        insertedCount += 1;
      } else if (observationChanged(existing, row)) {
        await ctx.db.patch(existing._id, { ...row, updatedAt: now });
        patchedCount += 1;
      } else {
        unchangedCount += 1;
      }
    }

    const prunedCount = await pruneExpiredRows(
      ctx,
      args.stationIcao,
      args.retentionCutoffUtc,
    );

    return {
      insertedCount,
      patchedCount,
      unchangedCount,
      prunedCount,
      rowCount: args.rows.length,
    };
  },
});

export const pruneExpiredSolarObservations = internalMutationGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    return {
      stationIcao,
      prunedCount: await pruneExpiredRows(
        ctx,
        stationIcao,
        Date.now() - OBSERVATION_RETENTION_MS,
      ),
    };
  },
});

export const writeCollectorStatus = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    runId: v.string(),
    status: collectorStatusValidator,
    configured: v.boolean(),
    lastAttemptAt: v.number(),
    lastAttemptAtLocal: v.string(),
    lastSuccessAt: v.optional(v.number()),
    lastSuccessAtLocal: v.optional(v.string()),
    latestObsTimeUtc: v.optional(v.number()),
    latestObsTimeLocal: v.optional(v.string()),
    lastResolvedFrameTimeUtc: v.optional(v.number()),
    lastError: v.optional(v.string()),
    requestedPointCount: v.optional(v.number()),
    storedRowCount: v.optional(v.number()),
    upwindStatus: v.optional(v.string()),
    windObservedAtUtc: v.optional(v.number()),
    windDirectionFromDeg: v.optional(v.number()),
    windSpeedKt: v.optional(v.number()),
    clearCollectionInFlight: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("seoulGk2aCollectorStatus")
      .withIndex("by_station", (query) =>
        query.eq("stationIcao", args.stationIcao),
      )
      .first();
    if (!existing || existing.collectionRunId !== args.runId) {
      return { updated: false, reason: "superseded" };
    }
    const approvalActive = hasApprovedNmscAccess();
    const { clearCollectionInFlight, ...requestedStatusFields } = args;
    delete requestedStatusFields.runId;
    // This mutation is the final boundary for every worker-status side effect.
    // If approval changed after the action's preceding check, clear the owned
    // lock but do not copy frame times, success metadata, or row counts from
    // the now-protected payload into the collector-status document.
    const statusFields = approvalActive
      ? requestedStatusFields
      : {
          stationIcao: args.stationIcao,
          status: COLLECTOR_STATUS.UNCONFIGURED,
          configured: false,
          lastAttemptAt: args.lastAttemptAt,
          lastAttemptAtLocal: args.lastAttemptAtLocal,
          lastError:
            "NMSC approval is required before GK2A NetCDF access can be enabled.",
          requestedPointCount: 0,
          storedRowCount: 0,
          upwindStatus: "unknown",
        };
    const patch = {
      ...statusFields,
      updatedAt: Date.now(),
      ...(clearCollectionInFlight
        ? {
            collectionInFlightSince: undefined,
            collectionMode: undefined,
            collectionRunId: undefined,
          }
        : {}),
    };
    if (
      approvalActive &&
      !statusFields.lastError &&
      (statusFields.status === COLLECTOR_STATUS.OK ||
        statusFields.status === COLLECTOR_STATUS.PARTIAL ||
        statusFields.status === COLLECTOR_STATUS.NO_DATA)
    ) {
      patch.lastError = undefined;
    }
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return {
        updated: true,
        ...(approvalActive ? {} : { status: "access_not_approved" }),
      };
    }
    return { updated: false, reason: "missing" };
  },
});

export const collectSolarHeating = internalActionGeneric({
  args: {
    stationIcao: v.string(),
    requestedAt: v.number(),
    mode: collectionModeValidator,
    runId: v.string(),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const lastAttemptAt = Date.now();
    const lastAttemptAtLocal = formatSeoulDateTime(lastAttemptAt);
    if (!hasApprovedNmscAccess()) {
      const message =
        "NMSC approval is required before GK2A NetCDF access can be enabled.";
      await ctx.runMutation(internal.seoulGk2aCollector.writeCollectorStatus, {
        stationIcao,
        runId: args.runId,
        status: COLLECTOR_STATUS.UNCONFIGURED,
        configured: false,
        lastAttemptAt,
        lastAttemptAtLocal,
        lastError: message,
        requestedPointCount: 0,
        storedRowCount: 0,
        upwindStatus: "unknown",
        clearCollectionInFlight: true,
      });
      return {
        ok: false,
        status: "access_not_approved",
        stationIcao,
        message,
      };
    }
    try {
      // Enforce the rolling retention window even when the upstream frame has
      // not advanced or the subsequent NMSC request fails.
      await ctx.runMutation(
        internal.seoulGk2aCollector.upsertAndPruneSolarObservations,
        {
          stationIcao,
          rows: [],
          retentionCutoffUtc: lastAttemptAt - OBSERVATION_RETENTION_MS,
        },
      );
      const [wind, latestStored, collectorState] = await Promise.all([
        ctx.runQuery(internal.seoulGk2a.getRecentWindForCollector, {
          stationIcao,
          now: args.requestedAt,
        }),
        ctx.runQuery(internal.seoulGk2aCollector.getLatestAirportObservation, {
          stationIcao,
        }),
        ctx.runQuery(internal.seoulGk2aCollector.getCollectorState, {
          stationIcao,
        }),
      ]);
      const sampling = buildSamplingPoints(wind, args.requestedAt);
      const latestKnownFrameTimeUtc = Math.max(
        Number.isFinite(latestStored?.obsTimeUtc)
          ? latestStored.obsTimeUtc
          : Number.NEGATIVE_INFINITY,
        Number.isFinite(collectorState?.lastResolvedFrameTimeUtc)
          ? collectorState.lastResolvedFrameTimeUtc
          : Number.NEGATIVE_INFINITY,
      );
      const result = await ctx.runAction(
        internal.seoulGk2aNode.fetchLatestSolarGrid,
        {
          requestedAt: args.requestedAt,
          ...(Number.isFinite(latestKnownFrameTimeUtc)
            ? { latestStoredObsTimeUtc: latestKnownFrameTimeUtc }
            : {}),
          points: sampling.points,
        },
      );

      // Recheck after the node action returns and before inspecting or storing
      // its protected payload. This closes the queued/in-flight revocation
      // race even if approval changed during discovery or download.
      if (result.status === "access_not_approved" || !hasApprovedNmscAccess()) {
        const message =
          "NMSC approval is required before GK2A NetCDF access can be enabled.";
        await ctx.runMutation(
          internal.seoulGk2aCollector.writeCollectorStatus,
          {
            stationIcao,
            runId: args.runId,
            status: COLLECTOR_STATUS.UNCONFIGURED,
            configured: false,
            lastAttemptAt,
            lastAttemptAtLocal,
            lastError: message,
            requestedPointCount: sampling.points.length,
            storedRowCount: 0,
            upwindStatus: sampling.upwindStatus,
            clearCollectionInFlight: true,
          },
        );
        return {
          ok: false,
          status: "access_not_approved",
          stationIcao,
          message,
        };
      }

      if (result.status === "not_modified") {
        const status = latestStored
          ? COLLECTOR_STATUS.OK
          : COLLECTOR_STATUS.NO_DATA;
        await ctx.runMutation(
          internal.seoulGk2aCollector.writeCollectorStatus,
          {
            stationIcao,
            runId: args.runId,
            status,
            configured: true,
            lastAttemptAt,
            lastAttemptAtLocal,
            ...(latestStored
              ? {
                  latestObsTimeUtc: latestStored.obsTimeUtc,
                  latestObsTimeLocal: latestStored.obsTimeLocal,
                }
              : {}),
            requestedPointCount: sampling.points.length,
            storedRowCount: 0,
            upwindStatus: sampling.upwindStatus,
            clearCollectionInFlight: true,
          },
        );
        return {
          ok: Boolean(latestStored),
          status: "not_modified",
          stationIcao,
        };
      }

      if (!hasUsefulSolarEnergy(result.observationTimeUtc)) {
        await ctx.runMutation(
          internal.seoulGk2aCollector.writeCollectorStatus,
          {
            stationIcao,
            runId: args.runId,
            status: COLLECTOR_STATUS.NO_DATA,
            configured: true,
            lastAttemptAt,
            lastAttemptAtLocal,
            lastError:
              "The latest GK2A frame was below the 50 W/m² modeled clear-sky collection threshold.",
            lastResolvedFrameTimeUtc: result.observationTimeUtc,
            requestedPointCount: sampling.points.length,
            storedRowCount: 0,
            upwindStatus: sampling.upwindStatus,
            clearCollectionInFlight: true,
          },
        );
        return {
          ok: false,
          status: "outside_collection_window",
          stationIcao,
        };
      }

      const rows = buildObservationRows(result, sampling);
      const airportRow = rows.find(
        (row) =>
          row.pointKind === POINT_KIND.AIRPORT && Number.isFinite(row.dsrWm2),
      );
      const sampleErrors = result.samples
        .filter((sample) => sample.error || !Number.isFinite(sample.dsrWm2))
        .map(
          (sample) =>
            `${sample.pointKind}: ${
              sample.error ?? "DSR quality flags rejected this grid cell"
            }`,
        );
      const status = !rows.length
        ? COLLECTOR_STATUS.NO_DATA
        : !airportRow || sampleErrors.length
          ? COLLECTOR_STATUS.PARTIAL
          : COLLECTOR_STATUS.OK;
      const writeResult = await ctx.runMutation(
        internal.seoulGk2aCollector.upsertAndPruneSolarObservations,
        {
          stationIcao,
          rows,
          retentionCutoffUtc: lastAttemptAt - OBSERVATION_RETENTION_MS,
        },
      );
      if (writeResult.status === "access_not_approved") {
        const message =
          "NMSC approval was removed before the downloaded GK2A rows could be stored.";
        await ctx.runMutation(
          internal.seoulGk2aCollector.writeCollectorStatus,
          {
            stationIcao,
            runId: args.runId,
            status: COLLECTOR_STATUS.UNCONFIGURED,
            configured: false,
            lastAttemptAt,
            lastAttemptAtLocal,
            lastError: message,
            requestedPointCount: sampling.points.length,
            storedRowCount: 0,
            upwindStatus: sampling.upwindStatus,
            clearCollectionInFlight: true,
          },
        );
        return {
          ok: false,
          status: "access_not_approved",
          stationIcao,
          message,
        };
      }
      const successful = Boolean(airportRow);
      await ctx.runMutation(internal.seoulGk2aCollector.writeCollectorStatus, {
        stationIcao,
        runId: args.runId,
        status,
        configured: true,
        lastAttemptAt,
        lastAttemptAtLocal,
        ...(successful
          ? {
              lastSuccessAt: lastAttemptAt,
              lastSuccessAtLocal: lastAttemptAtLocal,
              latestObsTimeUtc: airportRow.obsTimeUtc,
              latestObsTimeLocal: airportRow.obsTimeLocal,
            }
          : {}),
        ...(sampleErrors.length
          ? { lastError: sampleErrors.join("; ").slice(0, 500) }
          : {}),
        lastResolvedFrameTimeUtc: result.observationTimeUtc,
        requestedPointCount: sampling.points.length,
        storedRowCount: rows.length,
        upwindStatus: sampling.upwindStatus,
        ...(sampling.wind
          ? {
              windObservedAtUtc: sampling.wind.obsTimeUtc,
              windDirectionFromDeg: sampling.wind.windDirectionFromDeg,
              windSpeedKt: sampling.wind.windSpeedKt,
            }
          : {}),
        clearCollectionInFlight: true,
      });
      return {
        ok: successful,
        status,
        stationIcao,
        observationTimeUtc: result.observationTimeUtc,
        sourceFileName: result.fileName,
        ...writeResult,
      };
    } catch (error) {
      const approvalStillActive = hasApprovedNmscAccess();
      const message = approvalStillActive
        ? formatErrorMessage(error)
        : "NMSC approval is required before GK2A NetCDF access can be enabled.";
      await ctx.runMutation(internal.seoulGk2aCollector.writeCollectorStatus, {
        stationIcao,
        runId: args.runId,
        status: approvalStillActive
          ? COLLECTOR_STATUS.ERROR
          : COLLECTOR_STATUS.UNCONFIGURED,
        configured: approvalStillActive,
        lastAttemptAt,
        lastAttemptAtLocal,
        lastError: message,
        storedRowCount: 0,
        upwindStatus: "unknown",
        clearCollectionInFlight: true,
      });
      return {
        ok: false,
        status: approvalStillActive
          ? COLLECTOR_STATUS.ERROR
          : "access_not_approved",
        stationIcao,
        message,
      };
    }
  },
});
