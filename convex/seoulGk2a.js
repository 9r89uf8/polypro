import {
  actionGeneric,
  internalMutationGeneric,
  internalQueryGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

const SEOUL_TIMEZONE = "Asia/Seoul";
const RKSI_STATION_ICAO = "RKSI";
const RKSI_LATITUDE = 37.4602;
const RKSI_LONGITUDE = 126.4407;
const RKSI_REPRESENTATIVE_RUNWAY_NO = "2";
const RKSI_REPRESENTATIVE_RUNWAY_DIRECTION = "15L";

const KMA_SOURCE_ENDPOINT = "selectImgDown.do";
const PRODUCT_CADENCE_MINUTES = 10;
const MILLIS_PER_MINUTE = 60 * 1000;
const COLLECTION_LOCK_TIMEOUT_MS = 15 * 60 * 1000;
const OBSERVATION_RETENTION_MS = 48 * 60 * 60 * 1000;
const TRANSMISSION_MIN_CLEAR_SKY_WM2 = 50;
const FRESH_OBSERVATION_AGE_MINUTES = 35;
const DECISION_FRESH_OBSERVATION_AGE_MINUTES = 30;

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

const seoulDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEOUL_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
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

function isValidDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function shiftDateKey(dateKey, deltaDays) {
  const parsed = new Date(`${dateKey}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + deltaDays);
  return parsed.toISOString().slice(0, 10);
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
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

function hasUsefulSolarEnergy(epochMs) {
  return (
    haurwitzClearSkyDsr(epochMs, RKSI_LATITUDE, RKSI_LONGITUDE)
      .clearSkyDsrWm2 >= TRANSMISSION_MIN_CLEAR_SKY_WM2
  );
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

const pointKindValidator = v.union(
  v.literal(POINT_KIND.AIRPORT),
  v.literal(POINT_KIND.UPWIND_20M),
  v.literal(POINT_KIND.UPWIND_40M),
  v.literal(POINT_KIND.UPWIND_60M),
);

const collectorStatusValidator = v.union(
  v.literal(COLLECTOR_STATUS.OK),
  v.literal(COLLECTOR_STATUS.PARTIAL),
  v.literal(COLLECTOR_STATUS.NO_DATA),
  v.literal(COLLECTOR_STATUS.ERROR),
  v.literal(COLLECTOR_STATUS.UNCONFIGURED),
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
  dsrRawLine: v.optional(v.string()),
  asrRawLine: v.optional(v.string()),
  windObservedAtUtc: v.optional(v.number()),
  windDirectionFromDeg: v.optional(v.number()),
  windSpeedKt: v.optional(v.number()),
  windSpeedMps: v.optional(v.number()),
  source: v.string(),
  sourceEndpoint: v.string(),
  productCadenceMinutes: v.number(),
  collectionRunAt: v.number(),
});

function observationChanged(existing, candidate) {
  const fields = [
    "obsTimeLocal",
    "latitude",
    "longitude",
    "sourceLatitude",
    "sourceLongitude",
    "upwindMinutes",
    "distanceUpwindKm",
    "dsrWm2",
    "asrWm2",
    "clearSkyDsrWm2",
    "solarElevationDeg",
    "transmissionPct",
    "dsrRawLine",
    "asrRawLine",
    "windObservedAtUtc",
    "windDirectionFromDeg",
    "windSpeedKt",
    "windSpeedMps",
    "source",
    "sourceEndpoint",
    "productCadenceMinutes",
    "collectionRunAt",
  ];
  return fields.some(
    (field) =>
      Object.prototype.hasOwnProperty.call(candidate, field) &&
      existing[field] !== candidate[field],
  );
}

function windCadenceScore(row) {
  if (row.collectionCadence === "one_minute") {
    return 2;
  }
  if (row.collectionCadence === "five_minute") {
    return 1;
  }
  return 0;
}

export const getRecentWindForCollector = internalQueryGeneric({
  args: {
    stationIcao: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const currentDate = formatSeoulDate(args.now);
    const previousDate = shiftDateKey(currentDate, -1);
    const rowGroups = await Promise.all(
      [currentDate, previousDate].map((date) =>
        ctx.db
          .query("seoulAmosObservations")
          .withIndex("by_station_date_rwy_ts", (query) =>
            query
              .eq("stationIcao", args.stationIcao)
              .eq("date", date)
              .eq("rwyNo", RKSI_REPRESENTATIVE_RUNWAY_NO)
              .eq("rwyDir", RKSI_REPRESENTATIVE_RUNWAY_DIRECTION),
          )
          .order("desc")
          .take(20),
      ),
    );
    const rows = rowGroups
      .flat()
      .filter(
        (row) =>
          Number.isFinite(row.obsTimeUtc) &&
          row.obsTimeUtc <= args.now + MILLIS_PER_MINUTE &&
          Number.isFinite(row.windDirAvg) &&
          Number.isFinite(row.windSpeedAvg),
      )
      .sort(
        (left, right) =>
          right.obsTimeUtc - left.obsTimeUtc ||
          windCadenceScore(right) - windCadenceScore(left),
      );
    const latest = rows[0] ?? null;
    if (!latest) {
      return null;
    }
    const ageMinutes =
      Math.max(0, args.now - latest.obsTimeUtc) / MILLIS_PER_MINUTE;
    const windDirectionFromDeg =
      ((Number(latest.windDirAvg) % 360) + 360) % 360;
    const windSpeedKt = Math.max(0, Number(latest.windSpeedAvg));
    return {
      obsTimeUtc: latest.obsTimeUtc,
      obsTimeLocal: latest.obsTimeLocal,
      ageMinutes: round(ageMinutes, 1),
      windDirectionFromDeg: round(windDirectionFromDeg, 1),
      windSpeedKt: round(windSpeedKt, 1),
      windSpeedMps: round(windSpeedKt * 0.514444, 2),
      collectionCadence: latest.collectionCadence ?? "legacy",
    };
  },
});

export const upsertSolarObservations = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    rows: v.array(solarObservationValidator),
  },
  handler: async (ctx, args) => {
    // Retained for compatibility with the original collector, but it must
    // obey the same fail-closed storage boundary as the active collector.
    if (!hasApprovedNmscAccess()) {
      return {
        status: "access_not_approved",
        insertedCount: 0,
        patchedCount: 0,
        unchangedCount: 0,
        rowCount: 0,
        latestObsTimeUtc: null,
      };
    }
    const now = Date.now();
    let insertedCount = 0;
    let patchedCount = 0;
    let unchangedCount = 0;
    let latestObsTimeUtc = null;

    for (const row of args.rows) {
      if (!isValidDateKey(row.date)) {
        throw new Error(`Invalid GK2A observation date: ${row.date}`);
      }
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
      latestObsTimeUtc = Math.max(
        latestObsTimeUtc ?? Number.NEGATIVE_INFINITY,
        row.obsTimeUtc,
      );

      if (!existing) {
        await ctx.db.insert("seoulGk2aSolarObservations", {
          ...row,
          firstSeenAt: now,
          updatedAt: now,
        });
        insertedCount += 1;
        continue;
      }
      if (!observationChanged(existing, row)) {
        unchangedCount += 1;
        continue;
      }
      await ctx.db.patch(existing._id, {
        ...row,
        updatedAt: now,
      });
      patchedCount += 1;
    }

    return {
      insertedCount,
      patchedCount,
      unchangedCount,
      rowCount: args.rows.length,
      latestObsTimeUtc,
    };
  },
});

export const recordCollectorStatus = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
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
  },
  handler: async (ctx, args) => {
    if (!hasApprovedNmscAccess()) {
      return { status: "access_not_approved", configured: false };
    }
    const existing = await ctx.db
      .query("seoulGk2aCollectorStatus")
      .withIndex("by_station", (query) =>
        query.eq("stationIcao", args.stationIcao),
      )
      .first();
    const patch = { ...args, updatedAt: Date.now() };
    if (
      !args.lastError &&
      (args.status === COLLECTOR_STATUS.OK ||
        args.status === COLLECTOR_STATUS.PARTIAL)
    ) {
      patch.lastError = undefined;
    }
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return await ctx.db.get(existing._id);
    }
    const id = await ctx.db.insert("seoulGk2aCollectorStatus", patch);
    return await ctx.db.get(id);
  },
});

export const pollLatestSolarHeating = actionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) =>
    await ctx.runMutation(api.seoulGk2aCollector.requestSolarHeatingRefresh, {
      stationIcao: args.stationIcao,
    }),
});

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function findReferenceRow(rows, targetTimeUtc, toleranceMinutes = 15) {
  let best = null;
  let bestDifference = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (!Number.isFinite(row.transmissionPct)) {
      continue;
    }
    const difference = Math.abs(row.obsTimeUtc - targetTimeUtc);
    if (
      difference <= toleranceMinutes * MILLIS_PER_MINUTE &&
      difference < bestDifference
    ) {
      best = row;
      bestDifference = difference;
    }
  }
  return best;
}

function transmissionTrend(rows, latest) {
  if (!latest || !Number.isFinite(latest.transmissionPct)) {
    return {
      state: "unavailable",
      slopePctPointsPerHour: null,
      sampleCount: 0,
      coverageMinutes: 0,
    };
  }
  const recent = rows.filter(
    (row) =>
      Number.isFinite(row.transmissionPct) &&
      row.obsTimeUtc >= latest.obsTimeUtc - 60 * MILLIS_PER_MINUTE &&
      row.obsTimeUtc <= latest.obsTimeUtc,
  );
  const coverageMinutes = recent.length
    ? (recent.at(-1).obsTimeUtc - recent[0].obsTimeUtc) / MILLIS_PER_MINUTE
    : 0;
  const slopes = [];
  for (let leftIndex = 0; leftIndex < recent.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < recent.length;
      rightIndex += 1
    ) {
      const elapsedHours =
        (recent[rightIndex].obsTimeUtc - recent[leftIndex].obsTimeUtc) /
        (60 * MILLIS_PER_MINUTE);
      if (elapsedHours >= 1 / 6) {
        slopes.push(
          (recent[rightIndex].transmissionPct -
            recent[leftIndex].transmissionPct) /
            elapsedHours,
        );
      }
    }
  }
  const slope = median(slopes);
  if (recent.length < 3 || coverageMinutes < 30 || !Number.isFinite(slope)) {
    return {
      state: "unavailable",
      slopePctPointsPerHour: null,
      sampleCount: recent.length,
      coverageMinutes: round(coverageMinutes, 1),
    };
  }
  return {
    state: slope >= 5 ? "increasing" : slope <= -5 ? "decreasing" : "steady",
    slopePctPointsPerHour: round(slope, 1),
    sampleCount: recent.length,
    coverageMinutes: round(coverageMinutes, 1),
  };
}

function publicObservation(row) {
  if (!row) {
    return null;
  }
  return {
    obsTimeUtc: row.obsTimeUtc,
    obsTimeLocal: row.obsTimeLocal,
    pointKind: row.pointKind,
    latitude: row.latitude,
    longitude: row.longitude,
    ...(Number.isFinite(row.sourceLatitude)
      ? { sourceLatitude: row.sourceLatitude }
      : {}),
    ...(Number.isFinite(row.sourceLongitude)
      ? { sourceLongitude: row.sourceLongitude }
      : {}),
    ...(Number.isFinite(row.upwindMinutes)
      ? { upwindMinutes: row.upwindMinutes }
      : {}),
    ...(Number.isFinite(row.distanceUpwindKm)
      ? { distanceUpwindKm: row.distanceUpwindKm }
      : {}),
    ...(Number.isFinite(row.dsrWm2) ? { dsrWm2: row.dsrWm2 } : {}),
    ...(Number.isFinite(row.asrWm2) ? { asrWm2: row.asrWm2 } : {}),
    clearSkyDsrWm2: row.clearSkyDsrWm2,
    solarElevationDeg: row.solarElevationDeg,
    ...(Number.isFinite(row.transmissionPct)
      ? { transmissionPct: row.transmissionPct }
      : {}),
    ...(Number.isFinite(row.windObservedAtUtc)
      ? { windObservedAtUtc: row.windObservedAtUtc }
      : {}),
    ...(Number.isFinite(row.windDirectionFromDeg)
      ? { windDirectionFromDeg: row.windDirectionFromDeg }
      : {}),
    ...(Number.isFinite(row.windSpeedKt)
      ? { windSpeedKt: row.windSpeedKt }
      : {}),
    ...(Number.isFinite(row.windSpeedMps)
      ? { windSpeedMps: row.windSpeedMps }
      : {}),
    source: row.source,
    sourceEndpoint: row.sourceEndpoint,
    productCadenceMinutes: row.productCadenceMinutes,
    collectionRunAt: row.collectionRunAt,
  };
}

function dashboardStatusMessage(status, collector, latest, ageMinutes) {
  if (status === COLLECTOR_STATUS.UNCONFIGURED) {
    return "NMSC approval is required before automated GK2A NetCDF access can be enabled.";
  }
  if (status === "window_closed") {
    return "Scheduled and manual GK2A sampling are paused while modeled clear-sky irradiance is below 50 W/m².";
  }
  if (status === "night") {
    return "Solar transmission is not calculated while modeled clear-sky irradiance is below 50 W/m².";
  }
  if (status === "stale") {
    return `The latest GK2A grid observation is ${Math.round(
      ageMinutes,
    )} minutes old.`;
  }
  if (status === COLLECTOR_STATUS.ERROR) {
    return collector?.lastError ?? "The latest GK2A collection attempt failed.";
  }
  if (status === COLLECTOR_STATUS.NO_DATA || !latest) {
    return "No GK2A solar observation is stored for this date.";
  }
  if (status === COLLECTOR_STATUS.PARTIAL) {
    return "GK2A solar data are available, but one or more grid samples failed quality checks.";
  }
  return "GK2A surface shortwave radiation is current.";
}

function nullableNumber(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function findDecisionReferenceRow(rows, latest) {
  if (!latest) {
    return null;
  }
  return (
    rows
      .filter((row) => {
        const ageMinutes =
          (latest.obsTimeUtc - row.obsTimeUtc) / MILLIS_PER_MINUTE;
        return (
          ageMinutes >= 20 &&
          ageMinutes <= 35 &&
          Number.isFinite(row.dsrWm2) &&
          Number.isFinite(row.clearSkyDsrWm2)
        );
      })
      .sort((left, right) => {
        const leftAge =
          (latest.obsTimeUtc - left.obsTimeUtc) / MILLIS_PER_MINUTE;
        const rightAge =
          (latest.obsTimeUtc - right.obsTimeUtc) / MILLIS_PER_MINUTE;
        return (
          Math.abs(leftAge - 30) - Math.abs(rightAge - 30) ||
          right.obsTimeUtc - left.obsTimeUtc
        );
      })[0] ?? null
  );
}

function summarizeDecisionUpwind(upwindRowGroups, latest) {
  const matchingRows = latest
    ? upwindRowGroups
        .map(
          (rows) =>
            rows.find(
              (row) =>
                row.collectionRunAt === latest.collectionRunAt &&
                Math.abs(row.obsTimeUtc - latest.obsTimeUtc) <=
                  15 * MILLIS_PER_MINUTE,
            ) ?? null,
        )
        .filter(Boolean)
    : [];
  const transmissionRows = matchingRows.filter((row) =>
    Number.isFinite(row.transmissionPct),
  );
  const medianTransmissionPct = median(
    transmissionRows.map((row) => row.transmissionPct),
  );
  const differenceFromAirportPctPoints =
    Number.isFinite(medianTransmissionPct) &&
    Number.isFinite(latest?.transmissionPct)
      ? round(medianTransmissionPct - latest.transmissionPct, 1)
      : null;
  const signal = !Number.isFinite(differenceFromAirportPctPoints)
    ? "unavailable"
    : differenceFromAirportPctPoints >= 10
      ? "clearing"
      : differenceFromAirportPctPoints <= -10
        ? "cloudier"
        : "similar";
  const etaMinutes =
    signal === "clearing" || signal === "cloudier"
      ? ([...transmissionRows]
          .filter((row) =>
            signal === "clearing"
              ? row.transmissionPct - latest.transmissionPct >= 10
              : row.transmissionPct - latest.transmissionPct <= -10,
          )
          .sort(
            (left, right) =>
              (left.upwindMinutes ?? Number.POSITIVE_INFINITY) -
              (right.upwindMinutes ?? Number.POSITIVE_INFINITY),
          )[0]?.upwindMinutes ?? null)
      : null;
  return {
    status:
      matchingRows.length === 3
        ? "available"
        : matchingRows.length
          ? "partial"
          : "unavailable",
    signal,
    etaMinutes,
    pointCount: matchingRows.length,
    transmissionPointCount: transmissionRows.length,
    medianTransmissionPct: Number.isFinite(medianTransmissionPct)
      ? round(medianTransmissionPct, 1)
      : null,
    differenceFromAirportPctPoints,
  };
}

export const getSolarDecisionInputs = internalQueryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
    evaluatedAtUtc: v.number(),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    if (!isValidDateKey(args.date)) {
      throw new Error("Date must be a real YYYY-MM-DD calendar date.");
    }
    if (formatSeoulDate(args.evaluatedAtUtc) !== args.date) {
      throw new Error(
        "The solar decision date must match evaluatedAtUtc in Asia/Seoul.",
      );
    }

    const modeledNow = haurwitzClearSkyDsr(
      args.evaluatedAtUtc,
      RKSI_LATITUDE,
      RKSI_LONGITUDE,
    );
    const modeled30MinutesAgo = haurwitzClearSkyDsr(
      args.evaluatedAtUtc - 30 * MILLIS_PER_MINUTE,
      RKSI_LATITUDE,
      RKSI_LONGITUDE,
    );
    const usefulSolarEnergyRemaining =
      modeledNow.clearSkyDsrWm2 >= TRANSMISSION_MIN_CLEAR_SKY_WM2;
    const configured = hasApprovedNmscAccess();
    const modeledClearSkyChange30mWm2 = round(
      modeledNow.clearSkyDsrWm2 - modeled30MinutesAgo.clearSkyDsrWm2,
      1,
    );

    // Do not even query retained NMSC-derived rows after approval is removed.
    // The Haurwitz fields are locally modeled and remain sufficient to decide
    // whether the disabled solar input is still an active blocker.
    if (!configured) {
      return {
        stationIcao,
        date: args.date,
        evaluatedAtUtc: args.evaluatedAtUtc,
        solarStatus: usefulSolarEnergyRemaining
          ? "approval_required"
          : "low_solar",
        solarApprovalConfigured: false,
        solarCollectionEligibleNow: false,
        solarUsefulEnergyRemaining: usefulSolarEnergyRemaining,
        solarFreshnessLimitMinutes: DECISION_FRESH_OBSERVATION_AGE_MINUTES,
        solarModeledClearSkyDsrNowWm2: modeledNow.clearSkyDsrWm2,
        solarModeledSolarElevationNowDeg: modeledNow.solarElevationDeg,
        solarModeledClearSkyDsr30mAgoWm2: modeled30MinutesAgo.clearSkyDsrWm2,
        solarModeledClearSkyDsrChange30mWm2: modeledClearSkyChange30mWm2,
        solarObservationFresh: false,
        solarTransmissionTrend: "unavailable",
        solarTransmissionTrendSampleCount: 0,
        solarTransmissionTrendCoverageMinutes: 0,
        solarExpectedNextHour: "unavailable",
        solarUpwindStatus: "unavailable",
        solarUpwindSignal: "unavailable",
        solarUpwindPointCount: 0,
        solarUpwindTransmissionPointCount: 0,
        solarQualityUsable: false,
      };
    }

    const [collector, airportRows, ...upwindRowGroups] = await Promise.all([
      ctx.db
        .query("seoulGk2aCollectorStatus")
        .withIndex("by_station", (query) =>
          query.eq("stationIcao", stationIcao),
        )
        .first(),
      ctx.db
        .query("seoulGk2aSolarObservations")
        .withIndex("by_station_date_point_ts", (query) =>
          query
            .eq("stationIcao", stationIcao)
            .eq("date", args.date)
            .eq("pointKind", POINT_KIND.AIRPORT),
        )
        .collect(),
      ...[
        POINT_KIND.UPWIND_20M,
        POINT_KIND.UPWIND_40M,
        POINT_KIND.UPWIND_60M,
      ].map((pointKind) =>
        ctx.db
          .query("seoulGk2aSolarObservations")
          .withIndex("by_station_date_point_ts", (query) =>
            query
              .eq("stationIcao", stationIcao)
              .eq("date", args.date)
              .eq("pointKind", pointKind),
          )
          .order("desc")
          .take(24),
      ),
    ]);

    const orderedAirportRows = airportRows
      .filter(
        (row) =>
          row.obsTimeUtc >= args.evaluatedAtUtc - OBSERVATION_RETENTION_MS &&
          row.obsTimeUtc <=
            args.evaluatedAtUtc + PRODUCT_CADENCE_MINUTES * MILLIS_PER_MINUTE,
      )
      .sort((left, right) => left.obsTimeUtc - right.obsTimeUtc);
    const latest =
      [...orderedAirportRows]
        .reverse()
        .find((row) => Number.isFinite(row.dsrWm2)) ??
      orderedAirportRows.at(-1) ??
      null;
    const reference30Minutes = findDecisionReferenceRow(
      orderedAirportRows,
      latest,
    );
    const observationAgeMinutes = latest
      ? Math.max(0, args.evaluatedAtUtc - latest.obsTimeUtc) / MILLIS_PER_MINUTE
      : null;
    const observationFresh =
      Number.isFinite(latest?.dsrWm2) &&
      Number.isFinite(observationAgeMinutes) &&
      observationAgeMinutes <= DECISION_FRESH_OBSERVATION_AGE_MINUTES;
    const trend = transmissionTrend(orderedAirportRows, latest);
    const upwind = summarizeDecisionUpwind(upwindRowGroups, latest);
    const change30mActualMinutes = reference30Minutes
      ? round(
          (latest.obsTimeUtc - reference30Minutes.obsTimeUtc) /
            MILLIS_PER_MINUTE,
          1,
        )
      : null;
    const dsrChange30mWm2 =
      Number.isFinite(latest?.dsrWm2) &&
      Number.isFinite(reference30Minutes?.dsrWm2)
        ? round(latest.dsrWm2 - reference30Minutes.dsrWm2, 1)
        : null;
    const observedClearSkyChange30mWm2 =
      Number.isFinite(latest?.clearSkyDsrWm2) &&
      Number.isFinite(reference30Minutes?.clearSkyDsrWm2)
        ? round(latest.clearSkyDsrWm2 - reference30Minutes.clearSkyDsrWm2, 1)
        : null;
    const transmissionChange30mPctPoints =
      Number.isFinite(latest?.transmissionPct) &&
      Number.isFinite(reference30Minutes?.transmissionPct)
        ? round(latest.transmissionPct - reference30Minutes.transmissionPct, 1)
        : null;
    let status;
    if (!usefulSolarEnergyRemaining) {
      status = "low_solar";
    } else if (!configured) {
      status = "approval_required";
    } else if (!Number.isFinite(latest?.dsrWm2)) {
      status = "no_data";
    } else if (!observationFresh) {
      status = "stale";
    } else if (collector?.status === COLLECTOR_STATUS.ERROR) {
      status = "error";
    } else if (collector?.status === COLLECTOR_STATUS.PARTIAL) {
      status = "partial";
    } else {
      status = "ok";
    }

    return {
      stationIcao,
      date: args.date,
      evaluatedAtUtc: args.evaluatedAtUtc,
      solarStatus: status,
      solarApprovalConfigured: configured,
      solarCollectionEligibleNow: configured && usefulSolarEnergyRemaining,
      solarUsefulEnergyRemaining: usefulSolarEnergyRemaining,
      solarFreshnessLimitMinutes: DECISION_FRESH_OBSERVATION_AGE_MINUTES,
      solarModeledClearSkyDsrNowWm2: modeledNow.clearSkyDsrWm2,
      solarModeledSolarElevationNowDeg: modeledNow.solarElevationDeg,
      solarModeledClearSkyDsr30mAgoWm2: modeled30MinutesAgo.clearSkyDsrWm2,
      solarModeledClearSkyDsrChange30mWm2: modeledClearSkyChange30mWm2,
      solarObservedAtUtc: nullableNumber(latest?.obsTimeUtc),
      solarObservedAtLocal: latest?.obsTimeLocal ?? null,
      solarObservationAgeMinutes: Number.isFinite(observationAgeMinutes)
        ? round(observationAgeMinutes, 1)
        : null,
      solarObservationFresh: observationFresh,
      solarDsrWm2: nullableNumber(latest?.dsrWm2),
      solarAsrWm2: nullableNumber(latest?.asrWm2),
      solarClearSkyDsrWm2: nullableNumber(latest?.clearSkyDsrWm2),
      solarElevationDeg: nullableNumber(latest?.solarElevationDeg),
      solarTransmissionPct: nullableNumber(latest?.transmissionPct),
      solarReferenceObservedAtUtc: nullableNumber(
        reference30Minutes?.obsTimeUtc,
      ),
      solarChange30mActualMinutes: change30mActualMinutes,
      solarDsrChange30mWm2: dsrChange30mWm2,
      solarObservedClearSkyDsrChange30mWm2: observedClearSkyChange30mWm2,
      solarTransmissionChange30mPctPoints: transmissionChange30mPctPoints,
      solarTransmissionTrend: trend.state,
      solarTransmissionSlopePctPointsPerHour: trend.slopePctPointsPerHour,
      solarTransmissionTrendSampleCount: trend.sampleCount,
      solarTransmissionTrendCoverageMinutes: trend.coverageMinutes,
      solarExpectedNextHour:
        upwind.signal === "clearing"
          ? "increasing"
          : upwind.signal === "cloudier"
            ? "decreasing"
            : trend.state,
      solarUpwindStatus: upwind.status,
      solarUpwindSignal: upwind.signal,
      solarUpwindEtaMinutes: nullableNumber(upwind.etaMinutes),
      solarUpwindPointCount: upwind.pointCount,
      solarUpwindTransmissionPointCount: upwind.transmissionPointCount,
      solarUpwindMedianTransmissionPct: upwind.medianTransmissionPct,
      solarUpwindDifferencePctPoints: upwind.differenceFromAirportPctPoints,
      solarWindObservedAtUtc: nullableNumber(latest?.windObservedAtUtc),
      solarWindDirectionFromDeg: nullableNumber(
        latest?.windDirectionFromDeg ?? collector?.windDirectionFromDeg,
      ),
      solarWindSpeedKt: nullableNumber(
        latest?.windSpeedKt ?? collector?.windSpeedKt,
      ),
      solarWindSpeedMps: nullableNumber(latest?.windSpeedMps),
      solarSource: latest?.source ?? null,
      solarSourceEndpoint: latest?.sourceEndpoint ?? null,
      solarSourceFileName: latest?.sourceFileName ?? null,
      solarLatitude: nullableNumber(latest?.latitude),
      solarLongitude: nullableNumber(latest?.longitude),
      solarSourceLatitude: nullableNumber(latest?.sourceLatitude),
      solarSourceLongitude: nullableNumber(latest?.sourceLongitude),
      solarSourceGridRow: nullableNumber(latest?.sourceGridRow),
      solarSourceGridColumn: nullableNumber(latest?.sourceGridColumn),
      solarSampleKey: latest?.sampleKey ?? null,
      solarDsrQualityFlag: nullableNumber(latest?.dsrQualityFlag),
      solarAsrQualityFlag: nullableNumber(latest?.asrQualityFlag),
      solarShortwaveQualityFlag: nullableNumber(latest?.shortwaveQualityFlag),
      solarQualityUsable:
        Number.isFinite(latest?.dsrWm2) &&
        latest?.dsrQualityFlag === 1 &&
        latest?.shortwaveQualityFlag === 1,
      solarProductCadenceMinutes: nullableNumber(latest?.productCadenceMinutes),
      solarCollectionRunAt: nullableNumber(latest?.collectionRunAt),
      solarFirstSeenAt: nullableNumber(latest?.firstSeenAt),
      solarUpdatedAt: nullableNumber(latest?.updatedAt),
      solarCollectorStatus: collector?.status ?? null,
      solarCollectorUpwindStatus: collector?.upwindStatus ?? null,
      solarCollectorLastAttemptAt: nullableNumber(collector?.lastAttemptAt),
      solarCollectorLastSuccessAt: nullableNumber(collector?.lastSuccessAt),
    };
  },
});

export const getSolarHeatingDashboard = queryGeneric({
  args: {
    stationIcao: v.optional(v.string()),
    date: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stationIcao = normalizeStationIcao(args.stationIcao);
    const now = Date.now();
    const today = formatSeoulDate(now);
    const date = args.date ?? today;
    if (!isValidDateKey(date)) {
      throw new Error("Date must be a real YYYY-MM-DD calendar date.");
    }

    const configured = hasApprovedNmscAccess();
    const currentClearSky = haurwitzClearSkyDsr(
      now,
      RKSI_LATITUDE,
      RKSI_LONGITUDE,
    );
    const collectionWindowOpen = date === today && hasUsefulSolarEnergy(now);
    if (!configured) {
      const status = COLLECTOR_STATUS.UNCONFIGURED;
      return {
        stationIcao,
        date,
        today,
        configured: false,
        collectionWindowOpen,
        status,
        statusMessage: dashboardStatusMessage(status, null, null, null),
        source: {
          provider: "KMA/NMSC public satellite viewer",
          satellite: "GK2A",
          endpoint: KMA_SOURCE_ENDPOINT,
          productCadenceMinutes: PRODUCT_CADENCE_MINUTES,
          clearSkyModel: "Haurwitz",
        },
        collector: null,
        latest: null,
        observationAgeMinutes: null,
        currentDsrWm2: null,
        currentAsrWm2: null,
        currentClearSkyDsrWm2: null,
        currentSolarTransmissionPct: null,
        reference30Minutes: null,
        change30MinutesPctPoints: null,
        change30mPctPoints: null,
        change30mActualMinutes: null,
        trend: transmissionTrend([], null),
        expectedNextHour: "unavailable",
        cloudClearingUpstream: null,
        upstreamClearing: null,
        upstreamEtaMinutes: null,
        windDirectionDeg: null,
        windSpeedKt: null,
        sourceAgeMinutes: null,
        upstream: {
          status: "unavailable",
          signal: "unavailable",
          medianTransmissionPct: null,
          differenceFromAirportPctPoints: null,
          points: [],
        },
        samples: [],
        history: [],
      };
    }

    const [collector, airportRows, ...upwindRowGroups] = await Promise.all([
      ctx.db
        .query("seoulGk2aCollectorStatus")
        .withIndex("by_station", (query) =>
          query.eq("stationIcao", stationIcao),
        )
        .first(),
      ctx.db
        .query("seoulGk2aSolarObservations")
        .withIndex("by_station_date_point_ts", (query) =>
          query
            .eq("stationIcao", stationIcao)
            .eq("date", date)
            .eq("pointKind", POINT_KIND.AIRPORT),
        )
        .collect(),
      ...[
        POINT_KIND.UPWIND_20M,
        POINT_KIND.UPWIND_40M,
        POINT_KIND.UPWIND_60M,
      ].map((pointKind) =>
        ctx.db
          .query("seoulGk2aSolarObservations")
          .withIndex("by_station_date_point_ts", (query) =>
            query
              .eq("stationIcao", stationIcao)
              .eq("date", date)
              .eq("pointKind", pointKind),
          )
          .order("desc")
          .take(24),
      ),
    ]);
    const orderedAirportRows = airportRows
      .filter(
        (row) =>
          row.obsTimeUtc >= now - OBSERVATION_RETENTION_MS &&
          row.obsTimeUtc <= now + PRODUCT_CADENCE_MINUTES * MILLIS_PER_MINUTE,
      )
      .sort((left, right) => left.obsTimeUtc - right.obsTimeUtc);
    const latest =
      [...orderedAirportRows]
        .reverse()
        .find((row) => Number.isFinite(row.dsrWm2)) ??
      orderedAirportRows.at(-1) ??
      null;
    const ageMinutes =
      latest && date === today
        ? Math.max(0, now - latest.obsTimeUtc) / MILLIS_PER_MINUTE
        : null;
    const isNight =
      date === today &&
      currentClearSky.clearSkyDsrWm2 < TRANSMISSION_MIN_CLEAR_SKY_WM2;
    let status;
    if (isNight) {
      status = "night";
    } else if (date === today && !collectionWindowOpen) {
      status = "window_closed";
    } else if (
      date === today &&
      latest &&
      ageMinutes > FRESH_OBSERVATION_AGE_MINUTES
    ) {
      status = "stale";
    } else if (collector?.status === COLLECTOR_STATUS.ERROR && date === today) {
      status = COLLECTOR_STATUS.ERROR;
    } else if (!latest) {
      status =
        date === today &&
        collector?.status &&
        collector.status !== COLLECTOR_STATUS.UNCONFIGURED
          ? collector.status
          : COLLECTOR_STATUS.NO_DATA;
    } else if (
      date === today &&
      collector?.status === COLLECTOR_STATUS.PARTIAL
    ) {
      status = COLLECTOR_STATUS.PARTIAL;
    } else {
      status = COLLECTOR_STATUS.OK;
    }

    const reference30Minutes = latest
      ? findReferenceRow(
          orderedAirportRows,
          latest.obsTimeUtc - 30 * MILLIS_PER_MINUTE,
        )
      : null;
    const change30MinutesPctPoints =
      Number.isFinite(latest?.transmissionPct) &&
      Number.isFinite(reference30Minutes?.transmissionPct)
        ? round(latest.transmissionPct - reference30Minutes.transmissionPct, 1)
        : null;
    const change30mActualMinutes =
      Number.isFinite(latest?.transmissionPct) &&
      Number.isFinite(reference30Minutes?.transmissionPct)
        ? round(
            (latest.obsTimeUtc - reference30Minutes.obsTimeUtc) /
              MILLIS_PER_MINUTE,
            1,
          )
        : null;
    const trend = transmissionTrend(orderedAirportRows, latest);
    const matchingUpwindRows = latest
      ? upwindRowGroups
          .map(
            (rows) =>
              rows.find(
                (row) =>
                  row.collectionRunAt === latest.collectionRunAt &&
                  Math.abs(row.obsTimeUtc - latest.obsTimeUtc) <=
                    15 * MILLIS_PER_MINUTE,
              ) ?? null,
          )
          .filter(Boolean)
      : [];
    const upwindTransmissionPct = median(
      matchingUpwindRows.map((row) => row.transmissionPct),
    );
    const upwindDifferencePctPoints =
      Number.isFinite(upwindTransmissionPct) &&
      Number.isFinite(latest?.transmissionPct)
        ? round(upwindTransmissionPct - latest.transmissionPct, 1)
        : null;
    const cloudClearingUpstream = Number.isFinite(upwindDifferencePctPoints)
      ? upwindDifferencePctPoints >= 10
      : null;
    const upstreamSignal = !Number.isFinite(upwindDifferencePctPoints)
      ? "unavailable"
      : upwindDifferencePctPoints >= 10
        ? "clearing"
        : upwindDifferencePctPoints <= -10
          ? "cloudier"
          : "similar";
    const expectedNextHour =
      upstreamSignal === "clearing"
        ? "increasing"
        : upstreamSignal === "cloudier"
          ? "decreasing"
          : trend.state;
    const upstreamEtaMinutes =
      upstreamSignal === "clearing" || upstreamSignal === "cloudier"
        ? (matchingUpwindRows
            .filter(
              (row) =>
                Number.isFinite(row.transmissionPct) &&
                Number.isFinite(latest?.transmissionPct) &&
                (upstreamSignal === "clearing"
                  ? row.transmissionPct - latest.transmissionPct >= 10
                  : row.transmissionPct - latest.transmissionPct <= -10),
            )
            .sort(
              (left, right) =>
                (left.upwindMinutes ?? Number.POSITIVE_INFINITY) -
                (right.upwindMinutes ?? Number.POSITIVE_INFINITY),
            )[0]?.upwindMinutes ?? null)
        : null;
    const publicHistory = orderedAirportRows.map(publicObservation);

    return {
      stationIcao,
      date,
      today,
      configured,
      collectionWindowOpen,
      status,
      statusMessage: dashboardStatusMessage(
        status,
        collector,
        latest,
        ageMinutes,
      ),
      source: {
        provider: "KMA/NMSC public satellite viewer",
        satellite: "GK2A",
        endpoint: KMA_SOURCE_ENDPOINT,
        productCadenceMinutes: PRODUCT_CADENCE_MINUTES,
        clearSkyModel: "Haurwitz",
      },
      collector: collector
        ? {
            status: collector.status,
            configured,
            lastAttemptAt: collector.lastAttemptAt,
            lastAttemptAtLocal: collector.lastAttemptAtLocal,
            ...(Number.isFinite(collector.lastSuccessAt)
              ? {
                  lastSuccessAt: collector.lastSuccessAt,
                  lastSuccessAtLocal: collector.lastSuccessAtLocal,
                }
              : {}),
            ...(configured &&
            collector.status !== COLLECTOR_STATUS.OK &&
            collector.lastError
              ? { lastError: collector.lastError }
              : {}),
            ...(collector.upwindStatus
              ? { upwindStatus: collector.upwindStatus }
              : {}),
            ...(Number.isFinite(collector.collectionInFlightSince)
              ? {
                  collectionInFlightSince: collector.collectionInFlightSince,
                  collectionMode: collector.collectionMode ?? "unknown",
                  collectionActive:
                    now - collector.collectionInFlightSince <
                    COLLECTION_LOCK_TIMEOUT_MS,
                }
              : {}),
            ...(Number.isFinite(collector.collectionQueuedAt)
              ? { collectionQueuedAt: collector.collectionQueuedAt }
              : {}),
          }
        : null,
      latest: publicObservation(latest),
      observationAgeMinutes: Number.isFinite(ageMinutes)
        ? round(ageMinutes, 1)
        : null,
      currentDsrWm2: latest?.dsrWm2 ?? null,
      currentAsrWm2: latest?.asrWm2 ?? null,
      currentClearSkyDsrWm2: latest?.clearSkyDsrWm2 ?? null,
      currentSolarTransmissionPct: latest?.transmissionPct ?? null,
      reference30Minutes: publicObservation(reference30Minutes),
      change30MinutesPctPoints,
      change30mPctPoints: change30MinutesPctPoints,
      change30mActualMinutes,
      trend,
      expectedNextHour,
      cloudClearingUpstream,
      upstreamClearing: cloudClearingUpstream,
      upstreamEtaMinutes,
      windDirectionDeg:
        latest?.windDirectionFromDeg ?? collector?.windDirectionFromDeg ?? null,
      windSpeedKt: latest?.windSpeedKt ?? collector?.windSpeedKt ?? null,
      sourceAgeMinutes: Number.isFinite(ageMinutes)
        ? round(ageMinutes, 1)
        : null,
      upstream: {
        status:
          matchingUpwindRows.length === 3
            ? "available"
            : matchingUpwindRows.length
              ? "partial"
              : "unavailable",
        signal: upstreamSignal,
        medianTransmissionPct: Number.isFinite(upwindTransmissionPct)
          ? round(upwindTransmissionPct, 1)
          : null,
        differenceFromAirportPctPoints: upwindDifferencePctPoints,
        points: matchingUpwindRows
          .sort(
            (left, right) =>
              (left.upwindMinutes ?? 0) - (right.upwindMinutes ?? 0),
          )
          .map(publicObservation),
      },
      samples: publicHistory.slice(-12),
      history: publicHistory,
    };
  },
});
