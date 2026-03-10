import {
  actionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";

const CHICAGO_TIMEZONE = "America/Chicago";
const WEATHERCOM_API_BASE_URL = "https://api.weather.com";
const WEATHERCOM_PWS_CURRENT_URL =
  `${WEATHERCOM_API_BASE_URL}/v2/pws/observations/current`;
// Public Weather.com client key embedded in the Wunderground KORD page on 2026-03-09.
const WEATHERCOM_WUNDERGROUND_PWS_API_KEY =
  "e1f10a1e78da46f5b10a1e78da96f525";
const WEATHERCOM_PWS_SOURCE = "weathercom_pws_wunderground_embedded";
const WEATHERCOM_PWS_KEY_SOURCE = "wunderground_kord_page_2026_03_09";
const WEATHERCOM_PWS_FETCH_TIMEOUT_MS = 25000;

const DEFAULT_PWS_STATION_IDS_BY_ICAO = {
  KORD: ["KILCHICA999", "KILROSEM2", "KILBENSE14"],
};

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

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

function toCelsius(fahrenheit) {
  return roundToTenth(((fahrenheit - 32) * 5) / 9);
}

function mphToMps(mph) {
  return roundToTenth(mph * 0.44704);
}

function inHgToHpa(inHg) {
  return roundToTenth(inHg * 33.8638866667);
}

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
  const epoch = Date.parse(String(value ?? ""));
  return Number.isFinite(epoch) ? epoch : null;
}

function withOptionalField(target, key, value) {
  if (value !== null && value !== undefined) {
    target[key] = value;
  }
  return target;
}

function normalizeStationIds(stationIds) {
  const normalized = [];
  const seen = new Set();
  for (const value of stationIds ?? []) {
    const stationId = String(value ?? "").trim().toUpperCase();
    if (!stationId || seen.has(stationId)) {
      continue;
    }
    seen.add(stationId);
    normalized.push(stationId);
  }
  return normalized;
}

function buildWeatherComPwsCurrentUrl(stationId) {
  const params = new URLSearchParams();
  params.set("apiKey", WEATHERCOM_WUNDERGROUND_PWS_API_KEY);
  params.set("units", "e");
  params.set("stationId", stationId);
  params.set("format", "json");
  params.set("numericPrecision", "decimal");
  return `${WEATHERCOM_PWS_CURRENT_URL}?${params.toString()}`;
}

function parseWeatherComPwsRow(payload, stationIcao, requestedStationId) {
  const observations = Array.isArray(payload?.observations)
    ? payload.observations
    : [];
  const observation = observations[0];
  if (!observation) {
    throw new Error(`No PWS observation returned for ${requestedStationId}.`);
  }

  const pwsStationId = String(
    observation.stationID ?? requestedStationId ?? "",
  ).trim().toUpperCase();
  if (!pwsStationId) {
    throw new Error(`PWS response missing stationID for ${requestedStationId}.`);
  }

  const obsTimeUtc = parseUtcEpoch(observation.obsTimeUtc);
  if (obsTimeUtc === null) {
    throw new Error(`PWS response missing obsTimeUtc for ${pwsStationId}.`);
  }

  const imperial = observation.imperial ?? {};
  const tempF = parseNumber(imperial.temp);
  const dewpointF = parseNumber(imperial.dewpt);
  const heatIndexF = parseNumber(imperial.heatIndex);
  const windChillF = parseNumber(imperial.windChill);
  const windSpeedMph = parseNumber(imperial.windSpeed);
  const windGustMph = parseNumber(imperial.windGust);
  const pressureInHg = parseNumber(imperial.pressure);
  const precipRateIn = parseNumber(imperial.precipRate);
  const precipTotalIn = parseNumber(imperial.precipTotal);
  const elevFt = parseNumber(imperial.elev);

  const row = {
    stationIcao,
    pwsStationId,
    source: WEATHERCOM_PWS_SOURCE,
    keySource: WEATHERCOM_PWS_KEY_SOURCE,
    date: formatChicagoDate(obsTimeUtc),
    obsTimeUtc,
    obsTimeLocal: formatChicagoDateTime(obsTimeUtc),
  };

  withOptionalField(row, "neighborhood", observation.neighborhood || null);
  withOptionalField(row, "softwareType", observation.softwareType || null);
  withOptionalField(row, "country", observation.country || null);
  withOptionalField(row, "latitude", parseNumber(observation.lat));
  withOptionalField(row, "longitude", parseNumber(observation.lon));
  withOptionalField(row, "qcStatus", parseNumber(observation.qcStatus));
  withOptionalField(
    row,
    "realtimeFrequency",
    parseNumber(observation.realtimeFrequency),
  );
  withOptionalField(row, "solarRadiation", parseNumber(observation.solarRadiation));
  withOptionalField(row, "uv", parseNumber(observation.uv));
  withOptionalField(row, "relativeHumidity", parseNumber(observation.humidity));
  withOptionalField(row, "windDirDegrees", parseNumber(observation.winddir));
  withOptionalField(row, "tempF", tempF);
  withOptionalField(row, "tempC", tempF === null ? null : toCelsius(tempF));
  withOptionalField(row, "dewpointF", dewpointF);
  withOptionalField(
    row,
    "dewpointC",
    dewpointF === null ? null : toCelsius(dewpointF),
  );
  withOptionalField(row, "heatIndexF", heatIndexF);
  withOptionalField(
    row,
    "heatIndexC",
    heatIndexF === null ? null : toCelsius(heatIndexF),
  );
  withOptionalField(row, "windChillF", windChillF);
  withOptionalField(
    row,
    "windChillC",
    windChillF === null ? null : toCelsius(windChillF),
  );
  withOptionalField(row, "windSpeedMph", windSpeedMph);
  withOptionalField(
    row,
    "windSpeedMps",
    windSpeedMph === null ? null : mphToMps(windSpeedMph),
  );
  withOptionalField(row, "windGustMph", windGustMph);
  withOptionalField(
    row,
    "windGustMps",
    windGustMph === null ? null : mphToMps(windGustMph),
  );
  withOptionalField(row, "pressureInHg", pressureInHg);
  withOptionalField(
    row,
    "pressureHpa",
    pressureInHg === null ? null : inHgToHpa(pressureInHg),
  );
  withOptionalField(row, "precipRateIn", precipRateIn);
  withOptionalField(row, "precipTotalIn", precipTotalIn);
  withOptionalField(row, "elevFt", elevFt);

  return row;
}

async function fetchWeatherComPwsRow(stationIcao, pwsStationId) {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    WEATHERCOM_PWS_FETCH_TIMEOUT_MS,
  );

  try {
    const url = buildWeatherComPwsCurrentUrl(pwsStationId);
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `Weather.com PWS fetch failed for ${pwsStationId} (${response.status}).`,
      );
    }

    const payload = await response.json();
    return parseWeatherComPwsRow(payload, stationIcao, pwsStationId);
  } finally {
    clearTimeout(timeoutId);
  }
}

function observationChanged(existing, candidate) {
  const fields = [
    "source",
    "keySource",
    "obsTimeLocal",
    "neighborhood",
    "softwareType",
    "country",
    "latitude",
    "longitude",
    "qcStatus",
    "realtimeFrequency",
    "solarRadiation",
    "uv",
    "relativeHumidity",
    "windDirDegrees",
    "tempC",
    "tempF",
    "dewpointC",
    "dewpointF",
    "heatIndexC",
    "heatIndexF",
    "windChillC",
    "windChillF",
    "windSpeedMph",
    "windSpeedMps",
    "windGustMph",
    "windGustMps",
    "pressureInHg",
    "pressureHpa",
    "precipRateIn",
    "precipTotalIn",
    "elevFt",
  ];

  return fields.some((field) => {
    if (!(field in candidate)) {
      return false;
    }
    return (existing[field] ?? null) !== (candidate[field] ?? null);
  });
}

async function recomputeDailySummary(ctx, stationIcao, pwsStationId, date) {
  const rows = await ctx.db
    .query("weatherComPwsObservations")
    .withIndex("by_station_pws_date_ts", (query) =>
      query
        .eq("stationIcao", stationIcao)
        .eq("pwsStationId", pwsStationId)
        .eq("date", date),
    )
    .collect();

  const existing = await ctx.db
    .query("weatherComPwsDailySummaries")
    .withIndex("by_station_pws_date", (query) =>
      query
        .eq("stationIcao", stationIcao)
        .eq("pwsStationId", pwsStationId)
        .eq("date", date),
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
    pwsStationId,
    date,
    source: WEATHERCOM_PWS_SOURCE,
    keySource: WEATHERCOM_PWS_KEY_SOURCE,
    obsCount: rows.length,
    updatedAt: now,
  };
  withOptionalField(patch, "latestObsTimeUtc", latestRow?.obsTimeUtc ?? null);
  withOptionalField(patch, "latestObsTimeLocal", latestRow?.obsTimeLocal ?? null);
  withOptionalField(patch, "latestTempC", latestRow?.tempC ?? null);
  withOptionalField(patch, "latestTempF", latestRow?.tempF ?? null);
  withOptionalField(patch, "latestQcStatus", latestRow?.qcStatus ?? null);
  withOptionalField(
    patch,
    "latestNeighborhood",
    latestRow?.neighborhood ?? null,
  );
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

  await ctx.db.insert("weatherComPwsDailySummaries", patch);
}

export const upsertWeatherComPwsBatch = internalMutationGeneric({
  args: {
    stationIcao: v.string(),
    seenAt: v.number(),
    rows: v.array(
      v.object({
        stationIcao: v.string(),
        pwsStationId: v.string(),
        source: v.string(),
        keySource: v.string(),
        date: v.string(),
        obsTimeUtc: v.number(),
        obsTimeLocal: v.string(),
        neighborhood: v.optional(v.string()),
        softwareType: v.optional(v.string()),
        country: v.optional(v.string()),
        latitude: v.optional(v.number()),
        longitude: v.optional(v.number()),
        qcStatus: v.optional(v.number()),
        realtimeFrequency: v.optional(v.number()),
        solarRadiation: v.optional(v.number()),
        uv: v.optional(v.number()),
        relativeHumidity: v.optional(v.number()),
        windDirDegrees: v.optional(v.number()),
        tempC: v.optional(v.number()),
        tempF: v.optional(v.number()),
        dewpointC: v.optional(v.number()),
        dewpointF: v.optional(v.number()),
        heatIndexC: v.optional(v.number()),
        heatIndexF: v.optional(v.number()),
        windChillC: v.optional(v.number()),
        windChillF: v.optional(v.number()),
        windSpeedMph: v.optional(v.number()),
        windSpeedMps: v.optional(v.number()),
        windGustMph: v.optional(v.number()),
        windGustMps: v.optional(v.number()),
        pressureInHg: v.optional(v.number()),
        pressureHpa: v.optional(v.number()),
        precipRateIn: v.optional(v.number()),
        precipTotalIn: v.optional(v.number()),
        elevFt: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const seenAt = Math.round(args.seenAt);
    const now = Date.now();
    let insertedCount = 0;
    let patchedCount = 0;
    let unchangedCount = 0;
    const affectedKeys = new Set();

    for (const row of args.rows) {
      if (!parseDateKey(row.date)) {
        throw new Error(`Invalid date key: ${row.date}`);
      }

      const existing = await ctx.db
        .query("weatherComPwsObservations")
        .withIndex("by_station_pws_date_ts", (query) =>
          query
            .eq("stationIcao", row.stationIcao)
            .eq("pwsStationId", row.pwsStationId)
            .eq("date", row.date)
            .eq("obsTimeUtc", row.obsTimeUtc),
        )
        .first();

      affectedKeys.add(`${row.pwsStationId}::${row.date}`);

      if (!existing) {
        await ctx.db.insert("weatherComPwsObservations", {
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
        source: row.source,
        keySource: row.keySource,
        obsTimeLocal: row.obsTimeLocal,
        lastSeenAt: seenAt,
        updatedAt: now,
      };
      const patchableFields = [
        "neighborhood",
        "softwareType",
        "country",
        "latitude",
        "longitude",
        "qcStatus",
        "realtimeFrequency",
        "solarRadiation",
        "uv",
        "relativeHumidity",
        "windDirDegrees",
        "tempC",
        "tempF",
        "dewpointC",
        "dewpointF",
        "heatIndexC",
        "heatIndexF",
        "windChillC",
        "windChillF",
        "windSpeedMph",
        "windSpeedMps",
        "windGustMph",
        "windGustMps",
        "pressureInHg",
        "pressureHpa",
        "precipRateIn",
        "precipTotalIn",
        "elevFt",
      ];
      for (const field of patchableFields) {
        if (field in row) {
          patch[field] = row[field];
        }
      }
      await ctx.db.patch(existing._id, patch);
      patchedCount += 1;
    }

    for (const key of affectedKeys) {
      const [pwsStationId, date] = key.split("::");
      await recomputeDailySummary(ctx, args.stationIcao, pwsStationId, date);
    }

    return {
      insertedCount,
      patchedCount,
      unchangedCount,
      affectedSeriesCount: affectedKeys.size,
    };
  },
});

export const pollWeatherComPwsBatch = actionGeneric({
  args: {
    stationIcao: v.string(),
    pwsStationIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(args.stationIcao ?? "").trim().toUpperCase();
    if (!stationIcao) {
      throw new Error("stationIcao is required.");
    }

    const configuredStationIds =
      args.pwsStationIds?.length > 0
        ? args.pwsStationIds
        : DEFAULT_PWS_STATION_IDS_BY_ICAO[stationIcao];
    const pwsStationIds = normalizeStationIds(configuredStationIds);
    if (pwsStationIds.length === 0) {
      throw new Error(`No PWS station IDs configured for ${stationIcao}.`);
    }

    const seenAt = Date.now();
    const results = await Promise.all(
      pwsStationIds.map(async (pwsStationId) => {
        try {
          const row = await fetchWeatherComPwsRow(stationIcao, pwsStationId);
          return { ok: true, pwsStationId, row };
        } catch (error) {
          return {
            ok: false,
            pwsStationId,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );

    const successfulRows = results
      .filter((result) => result.ok)
      .map((result) => result.row);
    if (successfulRows.length === 0) {
      const errorSummary = results
        .map((result) => `${result.pwsStationId}: ${result.error}`)
        .join(" | ");
      throw new Error(
        `Weather.com PWS fetch failed for ${stationIcao}: ${errorSummary}`,
      );
    }

    const upsertResult = await ctx.runMutation("pws:upsertWeatherComPwsBatch", {
      stationIcao,
      seenAt,
      rows: successfulRows,
    });

    return {
      ok: true,
      partial: successfulRows.length !== results.length,
      stationIcao,
      requestedStationIds: pwsStationIds,
      savedKey: WEATHERCOM_WUNDERGROUND_PWS_API_KEY,
      keySource: WEATHERCOM_PWS_KEY_SOURCE,
      rowCount: successfulRows.length,
      latestByStation: successfulRows.map((row) => ({
        pwsStationId: row.pwsStationId,
        obsTimeUtc: row.obsTimeUtc,
        obsTimeLocal: row.obsTimeLocal,
        tempC: row.tempC ?? null,
        tempF: row.tempF ?? null,
        qcStatus: row.qcStatus ?? null,
      })),
      failures: results
        .filter((result) => !result.ok)
        .map((result) => ({
          pwsStationId: result.pwsStationId,
          error: result.error,
        })),
      ...upsertResult,
    };
  },
});

export const getDayWeatherComPws = queryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
    pwsStationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!parseDateKey(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }

    const stationIcao = String(args.stationIcao ?? "").trim().toUpperCase();
    const requestedPwsStationId = String(args.pwsStationId ?? "")
      .trim()
      .toUpperCase();

    if (requestedPwsStationId) {
      const rows = await ctx.db
        .query("weatherComPwsObservations")
        .withIndex("by_station_pws_date_ts", (query) =>
          query
            .eq("stationIcao", stationIcao)
            .eq("pwsStationId", requestedPwsStationId)
            .eq("date", args.date),
        )
        .collect();
      rows.sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);

      const summary = await ctx.db
        .query("weatherComPwsDailySummaries")
        .withIndex("by_station_pws_date", (query) =>
          query
            .eq("stationIcao", stationIcao)
            .eq("pwsStationId", requestedPwsStationId)
            .eq("date", args.date),
        )
        .first();

      return { rows, summaries: summary ? [summary] : [] };
    }

    const rows = await ctx.db
      .query("weatherComPwsObservations")
      .withIndex("by_station_date_ts", (query) =>
        query.eq("stationIcao", stationIcao).eq("date", args.date),
      )
      .collect();
    rows.sort((a, b) => {
      if (a.pwsStationId === b.pwsStationId) {
        return a.obsTimeUtc - b.obsTimeUtc;
      }
      return a.pwsStationId.localeCompare(b.pwsStationId);
    });

    const summaries = await ctx.db
      .query("weatherComPwsDailySummaries")
      .withIndex("by_station_date", (query) =>
        query.eq("stationIcao", stationIcao).eq("date", args.date),
      )
      .collect();
    summaries.sort((a, b) => a.pwsStationId.localeCompare(b.pwsStationId));

    return { rows, summaries };
  },
});
