import {
  actionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";

const CHICAGO_TIMEZONE = "America/Chicago";
const SYNOPTIC_TIMESERIES_URL =
  "https://api.synopticdata.com/v2/stations/timeseries";
const SYNOPTIC_SOURCE = "noaa_wrh_synoptic_hidden";
const SYNOPTIC_PROVIDER = "synoptic_hidden";
const SYNOPTIC_FETCH_TIMEOUT_MS = 25000;
const DEFAULT_RECENT_MINUTES = 30;
const MAX_RECENT_MINUTES = 180;
const MIN_RECENT_MINUTES = 10;

const chicagoDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CHICAGO_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const chicagoDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CHICAGO_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  hourCycle: "h23",
});

function getDateParts(formatter, date) {
  const parts = formatter.formatToParts(date);
  const values = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return values;
}

function formatChicagoDate(epochMs) {
  const parts = getDateParts(chicagoDateFormatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatChicagoDateTime(epochMs) {
  const parts = getDateParts(chicagoDateTimeFormatter, new Date(epochMs));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey ?? "");
  if (!match) {
    return null;
  }
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

function toCelsius(fahrenheit) {
  return roundToTenth(((fahrenheit - 32) * 5) / 9);
}

function mphToMps(mph) {
  return roundToTenth(mph * 0.44704);
}

function parseNumber(value) {
  if (value === undefined || value === null) {
    return null;
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseUtcEpoch(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }
  const normalized = raw.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const epoch = Date.parse(normalized);
  return Number.isFinite(epoch) ? epoch : null;
}

function toNonEmptyString(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function withOptionalField(target, key, value) {
  if (value !== null && value !== undefined) {
    target[key] = value;
  }
  return target;
}

function getSynopticToken() {
  const token = toNonEmptyString(process.env.NOAA_WRH_SYNOPTIC_TOKEN);
  if (!token) {
    throw new Error("Missing NOAA_WRH_SYNOPTIC_TOKEN.");
  }
  return token;
}

function buildSynopticTimeseriesUrl(stationIcao, recentMinutes) {
  const url = new URL(SYNOPTIC_TIMESERIES_URL);
  url.searchParams.set("STID", stationIcao);
  url.searchParams.set("showemptystations", "1");
  url.searchParams.set("units", "temp|F,speed|mph,english");
  url.searchParams.set("recent", String(recentMinutes));
  url.searchParams.set("complete", "1");
  url.searchParams.set("token", getSynopticToken());
  url.searchParams.set("obtimezone", "local");
  return url.toString();
}

function getArray(observations, key) {
  return Array.isArray(observations?.[key]) ? observations[key] : [];
}

function parseSynopticRows(payload, stationIcao) {
  const station = Array.isArray(payload?.STATION) ? payload.STATION[0] : null;
  if (!station) {
    throw new Error(`No Synoptic station payload returned for ${stationIcao}.`);
  }

  const observations = station.OBSERVATIONS ?? {};
  const times = getArray(observations, "date_time");
  if (times.length === 0) {
    return [];
  }

  const tempValues = getArray(observations, "air_temp_set_1");
  const dewpointValues = getArray(observations, "dew_point_temperature_set_1d");
  const rhValues = getArray(observations, "relative_humidity_set_1");
  const windDirValues = getArray(observations, "wind_direction_set_1");
  const windSpeedValues = getArray(observations, "wind_speed_set_1");
  const visibilityValues = getArray(observations, "visibility_set_1");
  const ceilingValues = getArray(observations, "ceiling_set_1");
  const altimeterValues = getArray(observations, "altimeter_set_1");
  const seaLevelPressureValues = getArray(
    observations,
    "sea_level_pressure_set_1d",
  );
  const weatherConditionValues = getArray(
    observations,
    "weather_condition_set_1d",
  );
  const weatherSummaryValues = getArray(observations, "weather_summary_set_1d");
  const metarValues = getArray(observations, "metar_set_1");
  const metarOriginValues = getArray(observations, "metar_origin_set_1");

  const rows = [];
  for (let index = 0; index < times.length; index += 1) {
    const obsTimeUtc = parseUtcEpoch(times[index]);
    if (obsTimeUtc === null) {
      continue;
    }

    const tempF = parseNumber(tempValues[index]);
    const dewpointF = parseNumber(dewpointValues[index]);
    const rawMetar = toNonEmptyString(metarValues[index]);
    const metarOrigin = toNonEmptyString(metarOriginValues[index]);

    if (tempF === null && !rawMetar && !metarOrigin) {
      continue;
    }

    const row = {
      stationIcao,
      provider: SYNOPTIC_PROVIDER,
      source: SYNOPTIC_SOURCE,
      date: formatChicagoDate(obsTimeUtc),
      obsTimeUtc,
      obsTimeLocal: formatChicagoDateTime(obsTimeUtc),
    };

    withOptionalField(row, "tempF", tempF);
    withOptionalField(row, "tempC", tempF === null ? null : toCelsius(tempF));
    withOptionalField(row, "dewpointF", dewpointF);
    withOptionalField(
      row,
      "dewpointC",
      dewpointF === null ? null : toCelsius(dewpointF),
    );
    withOptionalField(row, "relativeHumidity", parseNumber(rhValues[index]));
    withOptionalField(row, "windDirDegrees", parseNumber(windDirValues[index]));

    const windSpeedMph = parseNumber(windSpeedValues[index]);
    withOptionalField(row, "windSpeedMph", windSpeedMph);
    withOptionalField(
      row,
      "windSpeedMps",
      windSpeedMph === null ? null : mphToMps(windSpeedMph),
    );

    withOptionalField(row, "visibilityMiles", parseNumber(visibilityValues[index]));
    withOptionalField(row, "ceilingFt", parseNumber(ceilingValues[index]));
    withOptionalField(row, "altimeterInHg", parseNumber(altimeterValues[index]));
    withOptionalField(
      row,
      "seaLevelPressureMb",
      parseNumber(seaLevelPressureValues[index]),
    );
    withOptionalField(
      row,
      "weatherCondition",
      toNonEmptyString(weatherConditionValues[index]),
    );
    withOptionalField(
      row,
      "weatherSummary",
      toNonEmptyString(weatherSummaryValues[index]),
    );
    withOptionalField(row, "metarOrigin", metarOrigin);
    withOptionalField(row, "rawMetar", rawMetar);
    rows.push(row);
  }

  rows.sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);
  return rows;
}

function observationChanged(existing, candidate) {
  const fields = [
    "provider",
    "source",
    "obsTimeLocal",
    "tempC",
    "tempF",
    "dewpointC",
    "dewpointF",
    "relativeHumidity",
    "windDirDegrees",
    "windSpeedMph",
    "windSpeedMps",
    "visibilityMiles",
    "ceilingFt",
    "altimeterInHg",
    "seaLevelPressureMb",
    "weatherCondition",
    "weatherSummary",
    "metarOrigin",
    "rawMetar",
  ];
  return fields.some((field) => {
    if (!(field in candidate)) {
      return false;
    }
    return (existing[field] ?? null) !== (candidate[field] ?? null);
  });
}

async function recomputeDailySummary(ctx, stationIcao, date) {
  const rows = await ctx.db
    .query("synopticObservations")
    .withIndex("by_station_date_ts", (query) =>
      query.eq("stationIcao", stationIcao).eq("date", date),
    )
    .collect();

  const existing = await ctx.db
    .query("synopticDailySummaries")
    .withIndex("by_station_date", (query) =>
      query.eq("stationIcao", stationIcao).eq("date", date),
    )
    .first();

  if (rows.length === 0) {
    if (existing) {
      await ctx.db.delete(existing._id);
    }
    return;
  }

  let latestRow = null;
  let maxRow = null;
  let minRow = null;

  for (const row of rows) {
    if (!latestRow || row.obsTimeUtc > latestRow.obsTimeUtc) {
      latestRow = row;
    }
    if (row.tempC === undefined || row.tempC === null) {
      continue;
    }
    if (
      !maxRow ||
      row.tempC > maxRow.tempC ||
      (row.tempC === maxRow.tempC && row.obsTimeUtc > maxRow.obsTimeUtc)
    ) {
      maxRow = row;
    }
    if (
      !minRow ||
      row.tempC < minRow.tempC ||
      (row.tempC === minRow.tempC && row.obsTimeUtc > minRow.obsTimeUtc)
    ) {
      minRow = row;
    }
  }

  const now = Date.now();
  const patch = {
    stationIcao,
    date,
    obsCount: rows.length,
    updatedAt: now,
  };
  withOptionalField(patch, "latestObsTimeUtc", latestRow?.obsTimeUtc ?? null);
  withOptionalField(patch, "latestObsTimeLocal", latestRow?.obsTimeLocal ?? null);
  withOptionalField(patch, "latestRawMetar", latestRow?.rawMetar ?? null);
  withOptionalField(patch, "latestMetarOrigin", latestRow?.metarOrigin ?? null);
  withOptionalField(patch, "maxTempC", maxRow?.tempC ?? null);
  withOptionalField(patch, "maxTempF", maxRow?.tempF ?? null);
  withOptionalField(patch, "maxTempAtUtc", maxRow?.obsTimeUtc ?? null);
  withOptionalField(patch, "maxTempAtLocal", maxRow?.obsTimeLocal ?? null);
  withOptionalField(patch, "minTempC", minRow?.tempC ?? null);
  withOptionalField(patch, "minTempF", minRow?.tempF ?? null);
  withOptionalField(patch, "minTempAtUtc", minRow?.obsTimeUtc ?? null);
  withOptionalField(patch, "minTempAtLocal", minRow?.obsTimeLocal ?? null);

  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return;
  }

  await ctx.db.insert("synopticDailySummaries", patch);
}

export const upsertStationRowsBatch = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    seenAt: v.number(),
    rows: v.array(
      v.object({
        stationIcao: v.string(),
        provider: v.string(),
        source: v.string(),
        date: v.string(),
        obsTimeUtc: v.number(),
        obsTimeLocal: v.string(),
        tempC: v.optional(v.number()),
        tempF: v.optional(v.number()),
        dewpointC: v.optional(v.number()),
        dewpointF: v.optional(v.number()),
        relativeHumidity: v.optional(v.number()),
        windDirDegrees: v.optional(v.number()),
        windSpeedMph: v.optional(v.number()),
        windSpeedMps: v.optional(v.number()),
        visibilityMiles: v.optional(v.number()),
        ceilingFt: v.optional(v.number()),
        altimeterInHg: v.optional(v.number()),
        seaLevelPressureMb: v.optional(v.number()),
        weatherCondition: v.optional(v.string()),
        weatherSummary: v.optional(v.string()),
        metarOrigin: v.optional(v.string()),
        rawMetar: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const seenAt = Math.round(args.seenAt);
    const now = Date.now();
    let insertedCount = 0;
    let patchedCount = 0;
    let unchangedCount = 0;
    const affectedDates = new Set();

    for (const row of args.rows) {
      if (!parseDateKey(row.date)) {
        throw new Error(`Invalid date key: ${row.date}`);
      }

      const existing = await ctx.db
        .query("synopticObservations")
        .withIndex("by_station_date_ts", (query) =>
          query
            .eq("stationIcao", row.stationIcao)
            .eq("date", row.date)
            .eq("obsTimeUtc", row.obsTimeUtc),
        )
        .first();

      affectedDates.add(row.date);

      if (!existing) {
        await ctx.db.insert("synopticObservations", {
          ...row,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
          updatedAt: now,
        });
        insertedCount += 1;
        continue;
      }

      const changed = observationChanged(existing, row);
      if (!changed) {
        await ctx.db.patch(existing._id, {
          lastSeenAt: seenAt,
          updatedAt: now,
        });
        unchangedCount += 1;
        continue;
      }

      const patch = {
        provider: row.provider,
        source: row.source,
        obsTimeLocal: row.obsTimeLocal,
        lastSeenAt: seenAt,
        updatedAt: now,
      };
      const patchableFields = [
        "tempC",
        "tempF",
        "dewpointC",
        "dewpointF",
        "relativeHumidity",
        "windDirDegrees",
        "windSpeedMph",
        "windSpeedMps",
        "visibilityMiles",
        "ceilingFt",
        "altimeterInHg",
        "seaLevelPressureMb",
        "weatherCondition",
        "weatherSummary",
        "metarOrigin",
        "rawMetar",
      ];
      for (const field of patchableFields) {
        if (field in row) {
          patch[field] = row[field];
        }
      }
      await ctx.db.patch(existing._id, patch);
      patchedCount += 1;
    }

    for (const date of affectedDates) {
      await recomputeDailySummary(ctx, args.stationIcao, date);
    }

    return {
      insertedCount,
      patchedCount,
      unchangedCount,
      affectedDateCount: affectedDates.size,
    };
  },
});

export const pollStationTimeseries = actionGeneric({
  args: {
    stationIcao: v.string(),
    recentMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(args.stationIcao ?? "").trim().toUpperCase();
    if (!stationIcao) {
      throw new Error("stationIcao is required.");
    }

    const requestedRecent = Math.round(args.recentMinutes ?? DEFAULT_RECENT_MINUTES);
    const recentMinutes = Math.max(
      MIN_RECENT_MINUTES,
      Math.min(MAX_RECENT_MINUTES, requestedRecent),
    );
    const seenAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), SYNOPTIC_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(buildSynopticTimeseriesUrl(stationIcao, recentMinutes), {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
          Referer: `https://www.weather.gov/wrh/LowTimeseries?site=${stationIcao.toLowerCase()}`,
          Origin: "https://www.weather.gov",
          "User-Agent": "Mozilla/5.0",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `Synoptic fetch failed (${response.status}): ${text.slice(0, 200)}`,
        );
      }

      const payload = await response.json();
      const rows = parseSynopticRows(payload, stationIcao);
      const result = await ctx.runMutation("synoptic:upsertStationRowsBatch", {
        stationIcao,
        seenAt,
        rows,
      });
      const latestRow = rows.length > 0 ? rows[rows.length - 1] : null;

      return {
        ok: true,
        stationIcao,
        recentMinutes,
        rowCount: rows.length,
        latestObsTimeUtc: latestRow?.obsTimeUtc ?? null,
        latestObsTimeLocal: latestRow?.obsTimeLocal ?? null,
        latestTempC: latestRow?.tempC ?? null,
        latestTempF: latestRow?.tempF ?? null,
        latestRawMetar: latestRow?.rawMetar ?? null,
        availabilityLagMs:
          latestRow?.obsTimeUtc === undefined || latestRow?.obsTimeUtc === null
            ? null
            : Math.max(0, seenAt - latestRow.obsTimeUtc),
        ...result,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  },
});

export const getDayStationRows = queryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    if (!parseDateKey(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }

    const rows = await ctx.db
      .query("synopticObservations")
      .withIndex("by_station_date_ts", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .collect();
    rows.sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);

    const summary = await ctx.db
      .query("synopticDailySummaries")
      .withIndex("by_station_date", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .first();

    return { rows, summary };
  },
});
