import {
  actionGeneric,
  internalMutationGeneric,
  queryGeneric,
} from "convex/server";
import { v } from "convex/values";

const CHICAGO_TIMEZONE = "America/Chicago";
const MADIS_PUBLIC_CGI_URL =
  "https://madis-data.ncep.noaa.gov/madisPublic1/cgi-bin/madisXmlPublicDir";
const DEFAULT_LOOKBACK_MINUTES = 30;
const MADIS_PUBLIC_SOURCE = "madis_public_guest";
const MADIS_HFM_PROVIDER = "ASOS-HFM";
const MADIS_FETCH_TIMEOUT_MS = 25000;
const KELVIN_OFFSET = 273.15;

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
  hour12: false,
  hourCycle: "h23",
});

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

function toFahrenheit(celsius) {
  return roundToTenth((celsius * 9) / 5 + 32);
}

function kelvinToCelsius(kelvin) {
  return roundToTenth(kelvin - KELVIN_OFFSET);
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
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
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

function withOptionalField(target, key, value) {
  if (value !== null && value !== undefined) {
    target[key] = value;
  }
  return target;
}

function parseMadisUtcEpoch(obdate, obtime) {
  const dateMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(obdate).trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(String(obtime).trim());
  if (!dateMatch || !timeMatch) {
    return null;
  }
  const month = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(year) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    return null;
  }
  return Date.UTC(year, month - 1, day, hour, minute, 0, 0);
}

function parseCsv(csvText) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];

    if (char === '"') {
      if (inQuotes && csvText[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && csvText[i + 1] === "\n") {
        i += 1;
      }
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function extractPreCsv(htmlText) {
  const match = /<pre>([\s\S]*?)<\/pre>/i.exec(String(htmlText ?? ""));
  if (!match) {
    throw new Error("MADIS response did not include a PRE payload.");
  }
  return match[1].trim();
}

function buildMadisUrl(stationIcao, lookbackMinutes) {
  const params = new URLSearchParams();
  params.set("time", "0");
  params.set("minbck", `-${lookbackMinutes}`);
  params.set("minfwd", "0");
  params.set("recwin", "4");
  params.set("timefilter", "0");
  params.set("dfltrsel", "3");
  params.set("stanam", stationIcao);
  params.set("stasel", "1");
  params.set("pvdrsel", "0");
  params.set("varsel", "2");
  params.set("qctype", "0");
  params.set("qcsel", "0");
  params.set("xml", "5");
  params.set("csvmiss", "1");
  params.set("rdr", "");
  return `${MADIS_PUBLIC_CGI_URL}?${params.toString()}`;
}

function parseMadisRows(htmlText, stationIcao) {
  const csvText = extractPreCsv(htmlText);
  const parsedRows = parseCsv(csvText);
  if (parsedRows.length <= 1) {
    return [];
  }

  const rows = [];
  for (let i = 1; i < parsedRows.length; i += 1) {
    const row = parsedRows[i].map((cell) => String(cell ?? "").trim());
    if (row.length === 0 || row[0] !== stationIcao) {
      continue;
    }
    if (row[3] !== MADIS_HFM_PROVIDER) {
      continue;
    }

    const tsUtc = parseMadisUtcEpoch(row[1], row[2]);
    if (tsUtc === null) {
      continue;
    }

    const tempKelvin = parseNumber(row[9]);
    const dewpointKelvin = parseNumber(row[5]);
    const tempC = tempKelvin === null ? null : kelvinToCelsius(tempKelvin);
    const dewpointC =
      dewpointKelvin === null ? null : kelvinToCelsius(dewpointKelvin);

    const parsedRow = {
      stationIcao,
      provider: row[3],
      source: MADIS_PUBLIC_SOURCE,
      date: formatChicagoDate(tsUtc),
      obsTimeUtc: tsUtc,
      obsTimeLocal: formatChicagoDateTime(tsUtc),
    };
    withOptionalField(parsedRow, "tempC", tempC);
    withOptionalField(parsedRow, "tempF", tempC === null ? null : toFahrenheit(tempC));
    withOptionalField(parsedRow, "dewpointC", dewpointC);
    withOptionalField(
      parsedRow,
      "dewpointF",
      dewpointC === null ? null : toFahrenheit(dewpointC),
    );
    withOptionalField(parsedRow, "relativeHumidity", parseNumber(row[7]));
    withOptionalField(parsedRow, "windDirDegrees", parseNumber(row[11]));
    withOptionalField(parsedRow, "windSpeedMps", parseNumber(row[13]));
    withOptionalField(parsedRow, "windGustMps", parseNumber(row[15]));
    withOptionalField(parsedRow, "altimeterPa", parseNumber(row[17]));
    withOptionalField(parsedRow, "dewpointQcd", row[6] || null);
    withOptionalField(parsedRow, "relativeHumidityQcd", row[8] || null);
    withOptionalField(parsedRow, "tempQcd", row[10] || null);
    withOptionalField(parsedRow, "windDirQcd", row[12] || null);
    withOptionalField(parsedRow, "windSpeedQcd", row[14] || null);
    withOptionalField(parsedRow, "windGustQcd", row[16] || null);
    withOptionalField(parsedRow, "altimeterQcd", row[18] || null);
    rows.push(parsedRow);
  }

  rows.sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);
  return rows;
}

function observationChanged(existing, candidate) {
  const fields = [
    "tempC",
    "tempF",
    "dewpointC",
    "dewpointF",
    "relativeHumidity",
    "windDirDegrees",
    "windSpeedMps",
    "windGustMps",
    "altimeterPa",
    "dewpointQcd",
    "relativeHumidityQcd",
    "tempQcd",
    "windDirQcd",
    "windSpeedQcd",
    "windGustQcd",
    "altimeterQcd",
    "obsTimeLocal",
    "provider",
    "source",
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
    .query("madisHfmObservations")
    .withIndex("by_station_date_ts", (query) =>
      query.eq("stationIcao", stationIcao).eq("date", date),
    )
    .collect();

  const now = Date.now();
  const existing = await ctx.db
    .query("madisHfmDailySummaries")
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

  const patch = {
    stationIcao,
    date,
    obsCount: rows.length,
    updatedAt: now,
  };
  withOptionalField(patch, "latestObsTimeUtc", latestRow?.obsTimeUtc ?? null);
  withOptionalField(patch, "latestObsTimeLocal", latestRow?.obsTimeLocal ?? null);
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

  await ctx.db.insert("madisHfmDailySummaries", patch);
}

export const upsertPublicAsosHfmBatch = internalMutationGeneric({
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
        windSpeedMps: v.optional(v.number()),
        windGustMps: v.optional(v.number()),
        altimeterPa: v.optional(v.number()),
        dewpointQcd: v.optional(v.string()),
        relativeHumidityQcd: v.optional(v.string()),
        tempQcd: v.optional(v.string()),
        windDirQcd: v.optional(v.string()),
        windSpeedQcd: v.optional(v.string()),
        windGustQcd: v.optional(v.string()),
        altimeterQcd: v.optional(v.string()),
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
        .query("madisHfmObservations")
        .withIndex("by_station_date_ts", (query) =>
          query
            .eq("stationIcao", row.stationIcao)
            .eq("date", row.date)
            .eq("obsTimeUtc", row.obsTimeUtc),
        )
        .first();

      affectedDates.add(row.date);

      if (!existing) {
        await ctx.db.insert("madisHfmObservations", {
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
        "windSpeedMps",
        "windGustMps",
        "altimeterPa",
        "dewpointQcd",
        "relativeHumidityQcd",
        "tempQcd",
        "windDirQcd",
        "windSpeedQcd",
        "windGustQcd",
        "altimeterQcd",
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

export const pollPublicAsosHfm = actionGeneric({
  args: {
    stationIcao: v.string(),
    lookbackMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const stationIcao = String(args.stationIcao ?? "").trim().toUpperCase();
    if (!stationIcao) {
      throw new Error("stationIcao is required.");
    }

    const requestedLookback = Math.round(args.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES);
    const lookbackMinutes = Math.max(10, Math.min(180, requestedLookback));
    const seenAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), MADIS_FETCH_TIMEOUT_MS);

    try {
      const url = buildMadisUrl(stationIcao, lookbackMinutes);
      const response = await fetch(url, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`MADIS public fetch failed (${response.status}).`);
      }

      const htmlText = await response.text();
      const rows = parseMadisRows(htmlText, stationIcao);
      const result = await ctx.runMutation("madis:upsertPublicAsosHfmBatch", {
        stationIcao,
        seenAt,
        rows,
      });
      const latestRow = rows.length > 0 ? rows[rows.length - 1] : null;

      return {
        ok: true,
        stationIcao,
        lookbackMinutes,
        rowCount: rows.length,
        latestObsTimeUtc: latestRow?.obsTimeUtc ?? null,
        latestObsTimeLocal: latestRow?.obsTimeLocal ?? null,
        latestTempC: latestRow?.tempC ?? null,
        latestTempF: latestRow?.tempF ?? null,
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

export const getDayPublicAsosHfm = queryGeneric({
  args: {
    stationIcao: v.string(),
    date: v.string(),
  },
  handler: async (ctx, args) => {
    if (!parseDateKey(args.date)) {
      throw new Error("Date must be in YYYY-MM-DD format.");
    }

    const rows = await ctx.db
      .query("madisHfmObservations")
      .withIndex("by_station_date_ts", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .collect();
    rows.sort((a, b) => a.obsTimeUtc - b.obsTimeUtc);

    const summary = await ctx.db
      .query("madisHfmDailySummaries")
      .withIndex("by_station_date", (query) =>
        query.eq("stationIcao", args.stationIcao).eq("date", args.date),
      )
      .first();

    return { rows, summary };
  },
});
