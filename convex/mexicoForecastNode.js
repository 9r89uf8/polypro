"use node";

import { createHash } from "node:crypto";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StringDecoder } from "node:string_decoder";
import { createGunzip } from "node:zlib";
import { actionGeneric } from "convex/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api.js";

const STATION_ICAO = "MMMX";
const HOURLY_SOURCE = "smn_municipal_hourly";
const HOURLY_SOURCE_URL =
  "https://smn.conagua.gob.mx/tools/GUI/webservices/?method=3";
const DAILY_SOURCE = "smn_municipal_daily";
const DAILY_SOURCE_URL =
  "https://smn.conagua.gob.mx/tools/GUI/webservices/?method=1";
const TARGET_STATE_ID = "9";
const TARGET_MUNICIPALITY_ID = "17";
const TARGET_MUNICIPALITY_NAME = "Venustiano Carranza";
const COLLECTOR_COOLDOWN_MS = 30 * 60 * 1000;
const MAX_COMPRESSED_BYTES = 25 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_OBJECTS = 500_000;
const MAX_TARGET_ROWS = 1_000;

const mexicoDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Mexico_City",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function getDateParts(formatter, epochMs) {
  const values = {};
  for (const part of formatter.formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return values;
}

function formatMexicoDateTime(epochMs) {
  const parts = getDateParts(mexicoDateTimeFormatter, epochMs);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

function toFahrenheit(celsius) {
  return roundToTenth((celsius * 9) / 5 + 32);
}

function optionalNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function conditionKey(description, precipitationMm) {
  const normalized = String(description ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (/torment|electrica/.test(normalized)) {
    return "storm";
  }
  if (/lluv|chubasc|precipit/.test(normalized) || precipitationMm > 0.1) {
    return "rain";
  }
  if (/cubierto/.test(normalized)) {
    return "overcast";
  }
  if (/nublado/.test(normalized)) {
    return normalized.includes("medio") ? "partly_cloudy" : "cloudy";
  }
  if (/poco nuboso/.test(normalized)) {
    return "mostly_clear";
  }
  if (/despejado/.test(normalized)) {
    return "clear";
  }
  return "unknown";
}

export function parseSmnLocalHour(value, utcOffsetValue) {
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})$/.exec(
    String(value ?? "").trim(),
  );
  const utcOffsetHours = optionalNumber(utcOffsetValue);
  if (
    !match ||
    !Number.isInteger(utcOffsetHours) ||
    utcOffsetHours < -14 ||
    utcOffsetHours > 14
  ) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const forecastTimeUtc =
    Date.UTC(year, month - 1, day, hour, 0, 0) +
    utcOffsetHours * 60 * 60 * 1000;
  const check = new Date(Date.UTC(year, month - 1, day, hour, 0, 0));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour
  ) {
    return null;
  }
  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    forecastTimeUtc,
    forecastTimeLocal: `${match[1]}-${match[2]}-${match[3]} ${match[4]}:00:00`,
    utcOffsetHours,
  };
}

export function normalizeSmnRow(row) {
  if (
    String(row?.ides ?? "") !== TARGET_STATE_ID ||
    String(row?.idmun ?? "") !== TARGET_MUNICIPALITY_ID ||
    String(row?.nmun ?? "") !== TARGET_MUNICIPALITY_NAME
  ) {
    return null;
  }
  const time = parseSmnLocalHour(row?.hloc, row?.dh);
  const tempC = optionalNumber(row?.temp);
  if (!time || !Number.isFinite(tempC)) {
    return null;
  }
  const precipitationMm = optionalNumber(row?.prec);
  const precipitationProbabilityPct = optionalNumber(row?.probprec);
  const humidityPct = optionalNumber(row?.hr);
  const dewpointC = optionalNumber(row?.dpt);
  const windSpeedKph = optionalNumber(row?.velvien);
  const windDirectionDeg = optionalNumber(row?.dirvieng);
  const windGustKph = optionalNumber(row?.raf);
  const description = String(row?.desciel ?? "Sin descripción").trim();

  return {
    ...time,
    tempC: roundToTenth(tempC),
    tempF: toFahrenheit(tempC),
    conditionText: description,
    conditionKey: conditionKey(description, precipitationMm),
    ...(Number.isFinite(precipitationProbabilityPct)
      ? {
          precipitationProbabilityPct: roundToTenth(
            precipitationProbabilityPct,
          ),
        }
      : {}),
    ...(Number.isFinite(precipitationMm)
      ? { precipitationMm: roundToTenth(precipitationMm) }
      : {}),
    ...(Number.isFinite(humidityPct)
      ? { humidityPct: roundToTenth(humidityPct) }
      : {}),
    ...(Number.isFinite(dewpointC)
      ? {
          dewpointC: roundToTenth(dewpointC),
          dewpointF: toFahrenheit(dewpointC),
        }
      : {}),
    ...(Number.isFinite(windSpeedKph)
      ? { windSpeedKph: roundToTenth(windSpeedKph) }
      : {}),
    ...(row?.dirvienc
      ? { windDirectionText: String(row.dirvienc).trim() }
      : {}),
    ...(Number.isFinite(windDirectionDeg)
      ? { windDirectionDeg: roundToTenth(windDirectionDeg) }
      : {}),
    ...(Number.isFinite(windGustKph)
      ? { windGustKph: roundToTenth(windGustKph) }
      : {}),
    sourceRowJson: JSON.stringify(row),
  };
}

export function normalizeSmnDailyRow(row) {
  if (
    String(row?.ides ?? "") !== TARGET_STATE_ID ||
    String(row?.idmun ?? "") !== TARGET_MUNICIPALITY_ID ||
    String(row?.nmun ?? "") !== TARGET_MUNICIPALITY_NAME
  ) {
    return null;
  }
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})$/.exec(
    String(row?.dloc ?? "").trim(),
  );
  const forecastDayNumber = optionalNumber(row?.ndia);
  const tmaxC = optionalNumber(row?.tmax);
  const tminC = optionalNumber(row?.tmin);
  const utcOffsetHours = optionalNumber(row?.dh);
  if (
    !match ||
    match[4] !== "00" ||
    !Number.isFinite(tmaxC) ||
    (forecastDayNumber !== undefined &&
      (!Number.isInteger(forecastDayNumber) ||
        forecastDayNumber < 0 ||
        forecastDayNumber > 10)) ||
    (utcOffsetHours !== undefined &&
      (!Number.isInteger(utcOffsetHours) ||
        utcOffsetHours < -14 ||
        utcOffsetHours > 14))
  ) {
    return null;
  }
  const localClockUtc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
  );
  const check = new Date(localClockUtc);
  if (
    check.getUTCFullYear() !== Number(match[1]) ||
    check.getUTCMonth() !== Number(match[2]) - 1 ||
    check.getUTCDate() !== Number(match[3]) ||
    check.getUTCHours() !== Number(match[4])
  ) {
    return null;
  }
  const precipitationMm = optionalNumber(row?.prec);
  const precipitationProbabilityPct = optionalNumber(row?.probprec);
  const windSpeedKph = optionalNumber(row?.velvien);
  const windDirectionDeg = optionalNumber(row?.dirvieng);
  const windGustKph = optionalNumber(row?.raf);
  const cloudCoverPct = optionalNumber(row?.cc);
  const description = String(row?.desciel ?? "Sin descripción").trim();
  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    ...(Number.isInteger(forecastDayNumber) ? { forecastDayNumber } : {}),
    tmaxC: roundToTenth(tmaxC),
    tmaxF: toFahrenheit(tmaxC),
    ...(Number.isFinite(tminC)
      ? { tminC: roundToTenth(tminC), tminF: toFahrenheit(tminC) }
      : {}),
    conditionText: description,
    conditionKey: conditionKey(description, precipitationMm),
    ...(Number.isFinite(precipitationProbabilityPct)
      ? {
          precipitationProbabilityPct: roundToTenth(
            precipitationProbabilityPct,
          ),
        }
      : {}),
    ...(Number.isFinite(precipitationMm)
      ? { precipitationMm: roundToTenth(precipitationMm) }
      : {}),
    ...(Number.isFinite(cloudCoverPct)
      ? { cloudCoverPct: roundToTenth(cloudCoverPct) }
      : {}),
    ...(Number.isFinite(windSpeedKph)
      ? { windSpeedKph: roundToTenth(windSpeedKph) }
      : {}),
    ...(row?.dirvienc
      ? { windDirectionText: String(row.dirvienc).trim() }
      : {}),
    ...(Number.isFinite(windDirectionDeg)
      ? { windDirectionDeg: roundToTenth(windDirectionDeg) }
      : {}),
    ...(Number.isFinite(windGustKph)
      ? { windGustKph: roundToTenth(windGustKph) }
      : {}),
    ...(Number.isInteger(utcOffsetHours) ? { utcOffsetHours } : {}),
    sourceRowJson: JSON.stringify(row),
  };
}

async function parseSmnGzipStream(input, productLabel) {
  if (!input) {
    throw new Error(`${productLabel} response had no body stream.`);
  }
  const hash = createHash("sha256");
  let compressedBytes = 0;
  let decompressedBytes = 0;
  let totalObjectCount = 0;
  const targetRows = [];

  const hashingStream = new Transform({
    transform(chunk, _encoding, callback) {
      compressedBytes += chunk.length;
      if (compressedBytes > MAX_COMPRESSED_BYTES) {
        callback(
          new Error(`${productLabel} gzip exceeded the compressed size limit.`),
        );
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  const decoder = new StringDecoder("utf8");
  let rootState = "before_array";
  let objectText = "";
  let objectDepth = 0;
  let inString = false;
  let escaped = false;

  const isJsonWhitespace = (character) =>
    character === " " ||
    character === "\t" ||
    character === "\r" ||
    character === "\n";

  const startObject = () => {
    rootState = "in_object";
    objectText = "{";
    objectDepth = 1;
    inString = false;
    escaped = false;
  };

  const finishObject = () => {
    const parsed = JSON.parse(objectText);
    totalObjectCount += 1;
    if (totalObjectCount > MAX_TOTAL_OBJECTS) {
      throw new Error(`${productLabel} gzip exceeded the object-count limit.`);
    }
    if (
      String(parsed?.ides ?? "") === TARGET_STATE_ID &&
      String(parsed?.idmun ?? "") === TARGET_MUNICIPALITY_ID
    ) {
      targetRows.push(parsed);
      if (targetRows.length > MAX_TARGET_ROWS) {
        throw new Error(`${productLabel} gzip exceeded the target-row limit.`);
      }
    }
    objectText = "";
    rootState = "expect_comma_or_end";
  };

  const consume = (text) => {
    for (const character of text) {
      if (rootState === "before_array") {
        if (isJsonWhitespace(character)) {
          continue;
        }
        if (character !== "[") {
          throw new Error(`${productLabel} JSON root must open with an array.`);
        }
        rootState = "expect_value_or_end";
        continue;
      }

      if (rootState === "expect_value_or_end") {
        if (isJsonWhitespace(character)) {
          continue;
        }
        if (character === "]") {
          rootState = "after_array";
          continue;
        }
        if (character !== "{") {
          throw new Error(
            `${productLabel} JSON array entries must be objects.`,
          );
        }
        startObject();
        continue;
      }

      if (rootState === "expect_value") {
        if (isJsonWhitespace(character)) {
          continue;
        }
        if (character !== "{") {
          throw new Error(
            `${productLabel} JSON array has a missing object or trailing comma.`,
          );
        }
        startObject();
        continue;
      }

      if (rootState === "expect_comma_or_end") {
        if (isJsonWhitespace(character)) {
          continue;
        }
        if (character === ",") {
          rootState = "expect_value";
          continue;
        }
        if (character === "]") {
          rootState = "after_array";
          continue;
        }
        throw new Error(
          `${productLabel} JSON array is missing a comma or closing bracket.`,
        );
      }

      if (rootState === "after_array") {
        if (!isJsonWhitespace(character)) {
          throw new Error(
            `${productLabel} JSON has non-whitespace data after the root array.`,
          );
        }
        continue;
      }

      objectText += character;
      if (objectText.length > 32_000) {
        throw new Error(
          `${productLabel} JSON object exceeded the safe parser limit.`,
        );
      }
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === "\\") {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === "{") {
        objectDepth += 1;
      } else if (character === "}") {
        objectDepth -= 1;
        if (objectDepth === 0) {
          finishObject();
        }
      }
    }
  };

  const parserStream = new Writable({
    write(chunk, _encoding, callback) {
      try {
        decompressedBytes += chunk.length;
        if (decompressedBytes > MAX_DECOMPRESSED_BYTES) {
          throw new Error(
            `${productLabel} gzip exceeded the decompressed size limit.`,
          );
        }
        consume(decoder.write(chunk));
        callback();
      } catch (error) {
        callback(error);
      }
    },
    final(callback) {
      try {
        consume(decoder.end());
        if (
          rootState === "in_object" ||
          objectDepth !== 0 ||
          inString ||
          escaped
        ) {
          throw new Error(`${productLabel} gzip ended inside a JSON object.`);
        }
        if (rootState !== "after_array") {
          throw new Error(
            `${productLabel} gzip did not contain a complete JSON root array.`,
          );
        }
        callback();
      } catch (error) {
        callback(error);
      }
    },
  });
  const source =
    typeof input.getReader === "function" ? Readable.fromWeb(input) : input;
  await pipeline(source, hashingStream, createGunzip(), parserStream);
  return {
    rawHash: hash.digest("hex"),
    compressedBytes,
    decompressedBytes,
    totalObjectCount,
    targetRows,
  };
}

export async function parseSmnHourlyGzipStream(input) {
  return await parseSmnGzipStream(input, "SMN hourly");
}

// Both documented SMN municipal products use the same gzip-wrapped root JSON
// array. The streaming parser retains only Venustiano Carranza rows, keeping
// the all-Mexico payload out of Convex memory and storage.
export async function parseSmnDailyGzipStream(input) {
  return await parseSmnGzipStream(input, "SMN daily");
}

export const pollSmnHourlyForecast = actionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stationIcao = (args.stationIcao ?? STATION_ICAO).trim().toUpperCase();
    if (stationIcao !== STATION_ICAO) {
      throw new Error("The SMN hourly collector supports MMMX only.");
    }
    const previousStatus = await ctx.runQuery(api.mexico.getCollectorStatus, {
      stationIcao,
      source: HOURLY_SOURCE,
    });
    const claim = await ctx.runMutation(internal.mexico.claimCollectorAttempt, {
      stationIcao,
      source: HOURLY_SOURCE,
      cooldownMs: COLLECTOR_COOLDOWN_MS,
    });
    if (!claim.claimed) {
      return { status: "cooldown", retryAfterAt: claim.retryAfterAt };
    }

    try {
      const headers = {
        Accept: "application/octet-stream",
        "User-Agent":
          "polypro-mmmx-weather/1.0 (SMN documented municipal forecast collector)",
      };
      if (previousStatus?.lastModified) {
        headers["If-Modified-Since"] = previousStatus.lastModified;
      }
      const response = await fetch(HOURLY_SOURCE_URL, {
        cache: "no-store",
        headers,
      });
      const completedAt = Date.now();
      if (response.status === 304) {
        const finish = await ctx.runMutation(
          internal.mexico.finishCollectorAttempt,
          {
            attemptAt: claim.attemptAt,
            stationIcao,
            source: HOURLY_SOURCE,
            status: "not_modified",
            lastSuccessAt: previousStatus?.lastSuccessAt ?? completedAt,
            lastError: "",
            httpStatus: response.status,
            lastModified:
              response.headers.get("last-modified") ??
              previousStatus?.lastModified ??
              undefined,
            rowCount: previousStatus?.rowCount,
          },
        );
        if (finish.stale) {
          return { status: "superseded" };
        }
        return { status: "not_modified" };
      }
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `SMN hourly request failed (${response.status}): ${text.slice(0, 200)}`,
        );
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (
        !/(?:application\/octet-stream|application\/(?:x-)?gzip)/i.test(
          contentType,
        )
      ) {
        throw new Error(`Unexpected SMN hourly content type: ${contentType}`);
      }

      const parsed = await parseSmnHourlyGzipStream(response.body);
      const byForecastTime = new Map();
      for (const rawRow of parsed.targetRows) {
        const normalized = normalizeSmnRow(rawRow);
        if (normalized) {
          byForecastTime.set(normalized.forecastTimeUtc, normalized);
        }
      }
      const rows = Array.from(byForecastTime.values()).sort(
        (left, right) => left.forecastTimeUtc - right.forecastTimeUtc,
      );
      if (rows.length < 24) {
        throw new Error(
          `SMN hourly stream returned only ${rows.length} usable Venustiano Carranza rows.`,
        );
      }
      const sourceLastModified = response.headers.get("last-modified");
      const sourceLastModifiedAt = sourceLastModified
        ? Date.parse(sourceLastModified)
        : null;
      const result = await ctx.runMutation(
        internal.mexico.storeSmnForecastBatch,
        {
          attemptAt: claim.attemptAt,
          stationIcao,
          sourceUrl: HOURLY_SOURCE_URL,
          capturedAt: completedAt,
          ...(Number.isFinite(sourceLastModifiedAt)
            ? { sourceLastModifiedAt }
            : {}),
          rawHash: parsed.rawHash,
          compressedBytes: parsed.compressedBytes,
          decompressedBytes: parsed.decompressedBytes,
          totalObjectCount: parsed.totalObjectCount,
          rawMunicipalityRows: JSON.stringify(parsed.targetRows),
          rows,
        },
      );
      if (result.stale) {
        return { status: "superseded" };
      }
      const finish = await ctx.runMutation(
        internal.mexico.finishCollectorAttempt,
        {
          attemptAt: claim.attemptAt,
          stationIcao,
          source: HOURLY_SOURCE,
          status: "ok",
          lastSuccessAt: completedAt,
          lastError: "",
          httpStatus: response.status,
          responseBytes: parsed.compressedBytes,
          lastModified: sourceLastModified ?? undefined,
          cacheControl: response.headers.get("cache-control") ?? undefined,
          rowCount: rows.length,
        },
      );
      if (finish.stale) {
        return { status: "superseded" };
      }
      return {
        status: "ok",
        rowCount: rows.length,
        insertedCount: result.insertedCount,
        updatedCount: result.updatedCount,
        compressedBytes: parsed.compressedBytes,
        decompressedBytes: parsed.decompressedBytes,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const finish = await ctx.runMutation(
        internal.mexico.finishCollectorAttempt,
        {
          attemptAt: claim.attemptAt,
          stationIcao,
          source: HOURLY_SOURCE,
          status: "error",
          lastError: message,
        },
      );
      if (finish.stale) {
        return { status: "superseded" };
      }
      throw new Error(message);
    }
  },
});

export const pollSmnDailyForecast = actionGeneric({
  args: {
    stationIcao: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const stationIcao = (args.stationIcao ?? STATION_ICAO).trim().toUpperCase();
    if (stationIcao !== STATION_ICAO) {
      throw new Error("The SMN daily collector supports MMMX only.");
    }
    const previousStatus = await ctx.runQuery(api.mexico.getCollectorStatus, {
      stationIcao,
      source: DAILY_SOURCE,
    });
    const claim = await ctx.runMutation(internal.mexico.claimCollectorAttempt, {
      stationIcao,
      source: DAILY_SOURCE,
      cooldownMs: COLLECTOR_COOLDOWN_MS,
    });
    if (!claim.claimed) {
      return { status: "cooldown", retryAfterAt: claim.retryAfterAt };
    }

    try {
      const headers = {
        Accept: "application/octet-stream",
        "User-Agent":
          "polypro-mmmx-weather/1.0 (SMN documented municipal forecast collector)",
      };
      if (previousStatus?.lastModified) {
        headers["If-Modified-Since"] = previousStatus.lastModified;
      }
      const response = await fetch(DAILY_SOURCE_URL, {
        cache: "no-store",
        headers,
      });
      const completedAt = Date.now();
      if (response.status === 304) {
        const finish = await ctx.runMutation(
          internal.mexico.finishCollectorAttempt,
          {
            attemptAt: claim.attemptAt,
            stationIcao,
            source: DAILY_SOURCE,
            status: "not_modified",
            lastSuccessAt: previousStatus?.lastSuccessAt ?? completedAt,
            lastError: "",
            httpStatus: response.status,
            lastModified:
              response.headers.get("last-modified") ??
              previousStatus?.lastModified ??
              undefined,
            rowCount: previousStatus?.rowCount,
          },
        );
        if (finish.stale) {
          return { status: "superseded" };
        }
        return { status: "not_modified" };
      }
      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `SMN daily request failed (${response.status}): ${text.slice(0, 200)}`,
        );
      }
      const contentType = response.headers.get("content-type") ?? "";
      if (
        !/(?:application\/octet-stream|application\/(?:x-)?gzip)/i.test(
          contentType,
        )
      ) {
        throw new Error(`Unexpected SMN daily content type: ${contentType}`);
      }

      const parsed = await parseSmnDailyGzipStream(response.body);
      const rowsByDate = new Map();
      for (const rawRow of parsed.targetRows) {
        const normalized = normalizeSmnDailyRow(rawRow);
        if (normalized) {
          rowsByDate.set(normalized.date, normalized);
        }
      }
      const rows = Array.from(rowsByDate.values()).sort((left, right) =>
        left.date.localeCompare(right.date),
      );
      if (rows.length < 2 || rows.length > 10) {
        throw new Error(
          `SMN daily stream returned ${rows.length} usable Venustiano Carranza rows; expected 2–10.`,
        );
      }
      const sourceLastModified = response.headers.get("last-modified");
      const sourceLastModifiedAt = sourceLastModified
        ? Date.parse(sourceLastModified)
        : null;
      const result = await ctx.runMutation(
        internal.mexico.storeSmnDailyForecastBatch,
        {
          attemptAt: claim.attemptAt,
          stationIcao,
          sourceUrl: DAILY_SOURCE_URL,
          capturedAt: completedAt,
          ...(Number.isFinite(sourceLastModifiedAt)
            ? { sourceLastModifiedAt }
            : {}),
          rawHash: parsed.rawHash,
          compressedBytes: parsed.compressedBytes,
          decompressedBytes: parsed.decompressedBytes,
          totalObjectCount: parsed.totalObjectCount,
          rawMunicipalityRows: JSON.stringify(parsed.targetRows),
          rows,
        },
      );
      if (result.stale) {
        return { status: "superseded" };
      }
      const finish = await ctx.runMutation(
        internal.mexico.finishCollectorAttempt,
        {
          attemptAt: claim.attemptAt,
          stationIcao,
          source: DAILY_SOURCE,
          status: "ok",
          lastSuccessAt: completedAt,
          lastError: "",
          httpStatus: response.status,
          responseBytes: parsed.compressedBytes,
          lastModified: sourceLastModified ?? undefined,
          cacheControl: response.headers.get("cache-control") ?? undefined,
          rowCount: rows.length,
        },
      );
      if (finish.stale) {
        return { status: "superseded" };
      }
      return {
        status: "ok",
        rowCount: rows.length,
        insertedCount: result.insertedCount,
        updatedCount: result.updatedCount,
        removedCount: result.removedCount,
        compressedBytes: parsed.compressedBytes,
        decompressedBytes: parsed.decompressedBytes,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const finish = await ctx.runMutation(
        internal.mexico.finishCollectorAttempt,
        {
          attemptAt: claim.attemptAt,
          stationIcao,
          source: DAILY_SOURCE,
          status: "error",
          lastError: message,
        },
      );
      if (finish.stale) {
        return { status: "superseded" };
      }
      throw new Error(message);
    }
  },
});
