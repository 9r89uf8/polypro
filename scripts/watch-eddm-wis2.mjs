import mqtt from "mqtt";

const DEFAULT_BROKER_URL = "mqtts://everyone:everyone@globalbroker.meteo.fr:8883";
const DEFAULT_TOPIC =
  "cache/a/wis2/de-dwd/data/core/weather/surface-based-observations/synop";
const DEFAULT_STATION_IDENTIFIER = "0-20000-0-10870";
const DEFAULT_STATION_NAME = "MUENCHEN";
const DEFAULT_STATION_ICAO = "EDDM";
const DEFAULT_TGFTP_URL =
  "https://tgftp.nws.noaa.gov/data/observations/metar/stations/EDDM.TXT";
const DEFAULT_CONNECT_TIMEOUT_MS = 15000;
const DEFAULT_FETCH_TIMEOUT_MS = 20000;
const DEFAULT_TIMEOUT_MS = 75 * 60 * 1000;
const DEFAULT_LOG_EVERY = 50;

function parseNumberEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBooleanEnv(name, fallback = false) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (["1", "true", "yes", "y", "on"].includes(raw)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(raw)) {
    return false;
  }
  return fallback;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toIsoOrNull(epochMs) {
  return Number.isFinite(epochMs) ? new Date(epochMs).toISOString() : null;
}

function formatUtc(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  const date = new Date(epochMs);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}Z`;
}

function parseHttpTimestamp(value) {
  const epochMs = Date.parse(String(value ?? "").trim());
  return Number.isFinite(epochMs) ? epochMs : null;
}

function parseMetarTimestampFromRaw(rawMetar, nowEpochMs = Date.now()) {
  const match = /(?:^|(?:METAR|SPECI)\s+)[A-Z0-9]{4}\s+(\d{2})(\d{2})(\d{2})Z\b/.exec(
    String(rawMetar ?? "").trim(),
  );
  if (!match) {
    return null;
  }

  const now = new Date(nowEpochMs);
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  const reportDay = Number(match[1]);
  const reportHour = Number(match[2]);
  const reportMinute = Number(match[3]);

  const candidates = [
    Date.UTC(currentYear, currentMonth - 1, reportDay, reportHour, reportMinute, 0, 0),
    Date.UTC(currentYear, currentMonth, reportDay, reportHour, reportMinute, 0, 0),
    Date.UTC(currentYear, currentMonth + 1, reportDay, reportHour, reportMinute, 0, 0),
  ].filter(Number.isFinite);

  let bestCandidate = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - nowEpochMs);
    if (distance < bestDistance) {
      bestCandidate = candidate;
      bestDistance = distance;
    }
  }
  return bestCandidate;
}

function parseNoaaLatestTxt(rawText) {
  const cleaned = String(rawText ?? "")
    .replace(/\r/g, "")
    .trim();
  if (!cleaned) {
    throw new Error("NOAA latest response was empty.");
  }

  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error(`Unexpected NOAA latest format: ${cleaned.slice(0, 160)}`);
  }

  return {
    reportTsUtc: parseMetarTimestampFromRaw(lines.slice(1).join(" ").trim()),
    rawMetar: lines.slice(1).join(" ").trim(),
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      cache: "no-store",
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchCurrentTgftp(tgftpUrl) {
  const response = await fetchWithTimeout(
    tgftpUrl,
    {
      headers: {
        Accept: "text/plain,*/*",
        "Cache-Control": "no-cache",
      },
    },
    DEFAULT_FETCH_TIMEOUT_MS,
  );
  const fetchedAt = Date.now();
  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`tgftp fetch failed (${response.status}): ${rawText.slice(0, 160)}`);
  }
  const parsed = parseNoaaLatestTxt(rawText);
  return {
    fetchedAt,
    reportTsUtc: parsed.reportTsUtc,
    rawMetar: parsed.rawMetar,
    lastModifiedAt: parseHttpTimestamp(response.headers.get("last-modified")),
  };
}

function parseNotification(messageTopic, payload) {
  const parsed = JSON.parse(payload.toString("utf8"));
  const observationTime = Date.parse(
    String(parsed?.properties?.datetime ?? parsed?.time?.interval ?? "").trim(),
  );
  const pubtime = Date.parse(String(parsed?.properties?.pubtime ?? "").trim());
  const canonicalLink = Array.isArray(parsed?.links)
    ? parsed.links.find((link) => link?.rel === "canonical")
    : null;
  const alternateLink = Array.isArray(parsed?.links)
    ? parsed.links.find((link) => link?.rel === "alternate")
    : null;

  return {
    id: String(parsed?.id ?? ""),
    recvTopic: messageTopic,
    observationTime: Number.isFinite(observationTime) ? observationTime : null,
    pubtime: Number.isFinite(pubtime) ? pubtime : null,
    stationIdentifier: String(parsed?.properties?.station_identifier ?? "").trim() || null,
    metadataId: String(parsed?.properties?.metadata_id ?? "").trim() || null,
    dataId: String(parsed?.properties?.data_id ?? "").trim() || null,
    origin: String(parsed?.properties?.origin ?? "").trim() || null,
    coordinates: Array.isArray(parsed?.geometry?.coordinates)
      ? parsed.geometry.coordinates
      : null,
    canonicalHref: canonicalLink?.href ?? null,
    alternateHref: alternateLink?.href ?? null,
  };
}

function compactNotification(notification) {
  return {
    id: notification.id,
    recvTopic: notification.recvTopic,
    stationIdentifier: notification.stationIdentifier,
    observationTime: toIsoOrNull(notification.observationTime),
    pubtime: toIsoOrNull(notification.pubtime),
    pubLagSeconds:
      Number.isFinite(notification.pubtime) && Number.isFinite(notification.observationTime)
        ? Math.round((notification.pubtime - notification.observationTime) / 1000)
        : null,
    dataId: notification.dataId,
    origin: notification.origin,
    metadataId: notification.metadataId,
    coordinates: notification.coordinates,
    canonicalHref: notification.canonicalHref,
    alternateHref: notification.alternateHref,
  };
}

function buildMatchPredicate(config) {
  const stationIdentifier = String(config.stationIdentifier ?? "").trim();
  const matchAll = Boolean(config.matchAll);
  return (notification) => {
    if (matchAll) {
      return true;
    }
    if (!stationIdentifier) {
      return false;
    }
    if (notification.stationIdentifier === stationIdentifier) {
      return true;
    }
    if (
      String(notification.dataId ?? "").includes(
        stationIdentifier.replaceAll("/", "_"),
      )
    ) {
      return true;
    }
    // DWD publishes bulk SYNOP files for all of Germany without per-station
    // identifiers. Accept these bulk notifications so we can check the TGFTP
    // endpoint for the specific station's latest METAR.
    if (
      !notification.stationIdentifier &&
      String(notification.recvTopic ?? "").includes("de-dwd")
    ) {
      return true;
    }
    return false;
  };
}

function summarizeMatch(notification, tgftpSnapshot) {
  return {
    seenAt: new Date().toISOString(),
    notification: compactNotification(notification),
    tgftp: tgftpSnapshot
      ? {
          fetchedAt: toIsoOrNull(tgftpSnapshot.fetchedAt),
          reportTsUtc: toIsoOrNull(tgftpSnapshot.reportTsUtc),
          lastModifiedAt: toIsoOrNull(tgftpSnapshot.lastModifiedAt),
          rawMetar: tgftpSnapshot.rawMetar,
          currentIssueLagSeconds:
            Number.isFinite(tgftpSnapshot.fetchedAt) && Number.isFinite(tgftpSnapshot.reportTsUtc)
              ? Math.round((tgftpSnapshot.fetchedAt - tgftpSnapshot.reportTsUtc) / 1000)
              : null,
          sameIssueTimeAsNotification:
            Number.isFinite(tgftpSnapshot.reportTsUtc) &&
            Number.isFinite(notification.observationTime)
              ? tgftpSnapshot.reportTsUtc === notification.observationTime
              : null,
        }
      : null,
  };
}

function createConfig() {
  return {
    brokerUrl: String(process.env.WIS2_BROKER_URL ?? DEFAULT_BROKER_URL).trim(),
    topic: String(process.env.WIS2_TOPIC ?? DEFAULT_TOPIC).trim(),
    stationIdentifier: String(
      process.env.WIS2_STATION_IDENTIFIER ?? DEFAULT_STATION_IDENTIFIER,
    ).trim(),
    stationName: String(process.env.WIS2_STATION_NAME ?? DEFAULT_STATION_NAME).trim(),
    stationIcao: String(process.env.WIS2_STATION_ICAO ?? DEFAULT_STATION_ICAO).trim(),
    tgftpUrl: String(process.env.WIS2_TGFTP_URL ?? DEFAULT_TGFTP_URL).trim(),
    connectTimeoutMs: parseNumberEnv(
      "WIS2_CONNECT_TIMEOUT_MS",
      DEFAULT_CONNECT_TIMEOUT_MS,
    ),
    timeoutMs: parseNumberEnv("WIS2_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    logEvery: parseNumberEnv("WIS2_LOG_EVERY", DEFAULT_LOG_EVERY),
    printAll: parseBooleanEnv("WIS2_PRINT_ALL", false),
    matchAll: parseBooleanEnv("WIS2_MATCH_ALL", false),
    exitOnMatch: parseBooleanEnv("WIS2_EXIT_ON_MATCH", false),
  };
}

async function main() {
  const config = createConfig();
  const matchesNotification = buildMatchPredicate(config);
  const startedAt = Date.now();
  let scannedCount = 0;
  let matchedCount = 0;
  let timeoutId = null;

  console.log(
    JSON.stringify(
      {
        startedAt: new Date(startedAt).toISOString(),
        brokerUrl: config.brokerUrl,
        topic: config.topic,
        stationIdentifier: config.stationIdentifier,
        stationName: config.stationName,
        stationIcao: config.stationIcao,
        tgftpUrl: config.tgftpUrl,
        timeoutMs: config.timeoutMs,
        exitOnMatch: config.exitOnMatch,
        matchAll: config.matchAll,
      },
      null,
      2,
    ),
  );

  const client = mqtt.connect(config.brokerUrl, {
    protocolVersion: 5,
    connectTimeout: config.connectTimeoutMs,
    reconnectPeriod: 0,
  });

  function shutdown(code) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    client.end(true);
    process.exit(code);
  }

  timeoutId = setTimeout(() => {
    console.error(
      `Timed out after ${config.timeoutMs}ms with ${scannedCount} notifications scanned and ${matchedCount} matches.`,
    );
    shutdown(1);
  }, config.timeoutMs);

  process.on("SIGINT", () => {
    console.error("Interrupted.");
    shutdown(130);
  });

  client.on("connect", () => {
    console.log("Connected to WIS2 broker.");
    client.subscribe(config.topic, { qos: 0 }, (error) => {
      if (error) {
        console.error(`Subscribe failed: ${error.message}`);
        shutdown(1);
        return;
      }
      console.log(
        `Subscribed to ${config.topic} for ${config.stationName} (${config.stationIdentifier}, ${config.stationIcao}).`,
      );
    });
  });

  client.on("error", (error) => {
    console.error("MQTT error:", error, error?.code, error?.message);
    shutdown(1);
  });

  client.on("close", () => {
    console.error("MQTT connection closed.");
  });

  client.on("message", async (messageTopic, payload) => {
    scannedCount += 1;
    let notification;
    try {
      notification = parseNotification(messageTopic, payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Notification parse failed: ${message}`);
      return;
    }

    if (config.printAll) {
      console.log(JSON.stringify(compactNotification(notification), null, 2));
    } else if (config.logEvery > 0 && scannedCount % config.logEvery === 0) {
      console.log(
        `Scanned ${scannedCount} notifications. Latest station=${notification.stationIdentifier ?? "unknown"} pubtime=${formatUtc(notification.pubtime)}.`,
      );
    }

    if (!matchesNotification(notification)) {
      return;
    }

    matchedCount += 1;
    let tgftpSnapshot = null;
    try {
      tgftpSnapshot = await fetchCurrentTgftp(config.tgftpUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`tgftp snapshot failed: ${message}`);
    }

    console.log(JSON.stringify(summarizeMatch(notification, tgftpSnapshot), null, 2));

    if (config.exitOnMatch) {
      shutdown(0);
    }
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
