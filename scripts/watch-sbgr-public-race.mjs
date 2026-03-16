const STATION = "SBGR";
const INTERVAL_MS = Number(process.env.WATCH_INTERVAL_MS ?? 1000);
const TIMEOUT_MS = Number(process.env.WATCH_TIMEOUT_MS ?? 75 * 60 * 1000);
const REDEMET_API_KEY = "ouyaq0gZ4pEyTFIz86fJyby2snpspM66yU728dB2";
const TGFTP_URL =
  "https://tgftp.nws.noaa.gov/data/observations/metar/stations/SBGR.TXT";
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function parseHttpTimestamp(value) {
  const epochMs = Date.parse(String(value ?? "").trim());
  return Number.isFinite(epochMs) ? epochMs : null;
}

function formatUtcHourKey(epochMs) {
  const date = new Date(epochMs);
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}${pad2(
    date.getUTCHours(),
  )}`;
}

function toIsoOrNull(epochMs) {
  return Number.isFinite(epochMs) ? new Date(epochMs).toISOString() : null;
}

function parseMetarTimestampFromRaw(rawMetar, nowEpochMs = Date.now()) {
  const match = /^(METAR|SPECI)\s+[A-Z0-9]{4}\s+(\d{2})(\d{2})(\d{2})Z\b/.exec(
    String(rawMetar ?? "").trim(),
  );
  if (!match) {
    return null;
  }

  const now = new Date(nowEpochMs);
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  const reportDay = Number(match[2]);
  const reportHour = Number(match[3]);
  const reportMinute = Number(match[4]);

  const candidates = [
    Date.UTC(currentYear, currentMonth - 1, reportDay, reportHour, reportMinute, 0, 0),
    Date.UTC(currentYear, currentMonth, reportDay, reportHour, reportMinute, 0, 0),
    Date.UTC(currentYear, currentMonth + 1, reportDay, reportHour, reportMinute, 0, 0),
  ].filter(Number.isFinite);

  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - nowEpochMs);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function parseSqlTimestamp(value) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
      String(value ?? "").trim(),
    );
  if (!match) {
    return null;
  }
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0),
    0,
  );
}

function buildRedemetMessagesUrl(nowEpochMs = Date.now()) {
  const start = new Date(nowEpochMs - 12 * 60 * 60 * 1000);
  start.setUTCMinutes(0, 0, 0);
  const end = new Date(nowEpochMs + 2 * 60 * 60 * 1000);
  end.setUTCMinutes(0, 0, 0);
  return `https://api-redemet.decea.mil.br/mensagens/metar/${STATION}?api_key=${REDEMET_API_KEY}&data_ini=${formatUtcHourKey(start.getTime())}&data_fim=${formatUtcHourKey(end.getTime())}&page_tam=24`;
}

function parseRedemetMessages(payload) {
  const rows = Array.isArray(payload?.data?.data) ? payload.data.data : [];
  const normalized = rows
    .map((row) => {
      const rawMetar = String(row?.mens ?? "").trim();
      const reportTsUtc = parseSqlTimestamp(row?.validade_inicial);
      const receivedAt = parseSqlTimestamp(row?.recebimento);
      if (!rawMetar || !Number.isFinite(reportTsUtc)) {
        return null;
      }
      return {
        rawMetar,
        reportTsUtc,
        receivedAt,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.reportTsUtc !== right.reportTsUtc) {
        return right.reportTsUtc - left.reportTsUtc;
      }
      return (right.receivedAt ?? Number.NEGATIVE_INFINITY) -
        (left.receivedAt ?? Number.NEGATIVE_INFINITY);
    });

  if (!normalized.length) {
    throw new Error("Unexpected REDEMET mensagens/metar payload.");
  }
  return normalized[0];
}

async function fetchRedemet() {
  const response = await fetch(buildRedemetMessagesUrl(), {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  const fetchedAt = Date.now();
  if (!response.ok) {
    throw new Error(`REDEMET ${response.status}`);
  }
  const payload = await response.json();
  const parsed = parseRedemetMessages(payload);
  return {
    source: "redemet",
    fetchedAt,
    reportTsUtc: parsed.reportTsUtc,
    rawMetar: parsed.rawMetar,
    receivedAt: parsed.receivedAt,
    headers: {
      date: response.headers.get("date"),
      age: response.headers.get("age"),
      cacheControl: response.headers.get("cache-control"),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    },
  };
}

function parseTgftp(rawText) {
  const cleaned = String(rawText ?? "").replace(/\r/g, "").trim();
  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error(`Unexpected tgftp response: ${cleaned.slice(0, 120)}`);
  }
  const stampMatch = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/.exec(lines[0]);
  if (!stampMatch) {
    throw new Error(`Unexpected tgftp timestamp line: ${lines[0]}`);
  }
  return {
    reportTsUtc: Date.UTC(
      Number(stampMatch[1]),
      Number(stampMatch[2]) - 1,
      Number(stampMatch[3]),
      Number(stampMatch[4]),
      Number(stampMatch[5]),
      0,
      0,
    ),
    rawMetar: lines.slice(1).join(" ").trim(),
  };
}

async function fetchTgftp() {
  const response = await fetch(TGFTP_URL, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  const fetchedAt = Date.now();
  if (!response.ok) {
    throw new Error(`tgftp ${response.status}`);
  }
  const text = await response.text();
  const parsed = parseTgftp(text);
  return {
    source: "tgftp",
    fetchedAt,
    reportTsUtc: parsed.reportTsUtc,
    rawMetar: parsed.rawMetar,
    headers: {
      date: response.headers.get("date"),
      age: response.headers.get("age"),
      cacheControl: response.headers.get("cache-control"),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    },
  };
}

function formatShort(epochMs) {
  if (!Number.isFinite(epochMs)) {
    return "—";
  }
  const date = new Date(epochMs);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}Z`;
}

function compactResult(result) {
  return {
    source: result.source,
    fetchedAt: formatShort(result.fetchedAt),
    reportTsUtc: formatShort(result.reportTsUtc),
    receivedAt: formatShort(result.receivedAt),
    rawMetar: result.rawMetar,
    headers: result.headers,
  };
}

async function sampleAll() {
  const [redemet, tgftp] = await Promise.all([
    fetchRedemet(),
    fetchTgftp(),
  ]);
  return { redemet, tgftp };
}

async function sampleAllWithFallback(previousSample = null) {
  const settled = await Promise.allSettled([
    fetchRedemet(),
    fetchTgftp(),
  ]);
  const sources = ["redemet", "tgftp"];
  const sample = {};

  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const result = settled[index];
    if (result.status === "fulfilled") {
      sample[source] = result.value;
      continue;
    }

    const message =
      result.reason instanceof Error ? result.reason.message : String(result.reason);
    console.log(
      `# Warning ${source} sample failed at ${formatShort(Date.now())}: ${message}`,
    );

    if (previousSample?.[source]) {
      sample[source] = previousSample[source];
      continue;
    }

    throw result.reason;
  }

  return sample;
}

function getMaxReportTs(sample) {
  return Math.max(
    sample.redemet.reportTsUtc ?? Number.NEGATIVE_INFINITY,
    sample.tgftp.reportTsUtc ?? Number.NEGATIVE_INFINITY,
  );
}

async function main() {
  console.log(`# Watching ${STATION} REDEMET mensagens/metar vs tgftp`);
  console.log(`# Started at ${formatShort(Date.now())}`);
  console.log(`# Interval ${INTERVAL_MS} ms, timeout ${TIMEOUT_MS} ms`);

  const baseline = await sampleAllWithFallback();
  const baselineMaxTs = getMaxReportTs(baseline);
  console.log(JSON.stringify({ baseline: {
    redemet: compactResult(baseline.redemet),
    tgftp: compactResult(baseline.tgftp),
  } }, null, 2));

  const deadline = Date.now() + TIMEOUT_MS;
  let targetReportTsUtc = null;
  const firstSeen = {
    redemet: null,
    tgftp: null,
  };
  const latestHits = {
    redemet: baseline.redemet,
    tgftp: baseline.tgftp,
  };

  while (Date.now() < deadline) {
    const sample = await sampleAllWithFallback(latestHits);
    latestHits.redemet = sample.redemet;
    latestHits.tgftp = sample.tgftp;

    if (!Number.isFinite(targetReportTsUtc)) {
      const candidateTs = getMaxReportTs(sample);
      if (Number.isFinite(candidateTs) && candidateTs > baselineMaxTs) {
        targetReportTsUtc = candidateTs;
        console.log(
          `# Detected new report timestamp ${formatShort(targetReportTsUtc)} at ${formatShort(Date.now())}`,
        );
      }
    }

    if (Number.isFinite(targetReportTsUtc)) {
      for (const source of ["redemet", "tgftp"]) {
        if (!firstSeen[source] && sample[source].reportTsUtc === targetReportTsUtc) {
          firstSeen[source] = sample[source];
          console.log(
            JSON.stringify(
              {
                source,
                firstSeenAt: formatShort(sample[source].fetchedAt),
                reportTsUtc: formatShort(sample[source].reportTsUtc),
                receivedAt: formatShort(sample[source].receivedAt),
                rawMetar: sample[source].rawMetar,
                headers: sample[source].headers,
              },
              null,
              2,
            ),
          );
        }
      }

      if (firstSeen.redemet && firstSeen.tgftp) {
        break;
      }
    }

    await sleep(INTERVAL_MS);
  }

  const summary = {
    targetReportTsUtc: toIsoOrNull(targetReportTsUtc),
    firstSeen: Object.fromEntries(
      Object.entries(firstSeen).map(([source, hit]) => [
        source,
        hit
          ? {
              fetchedAt: toIsoOrNull(hit.fetchedAt),
              receivedAt: toIsoOrNull(hit.receivedAt),
              rawMetar: hit.rawMetar,
              headers: hit.headers,
            }
          : null,
      ]),
    ),
    latestHits: {
      redemet: compactResult(latestHits.redemet),
      tgftp: compactResult(latestHits.tgftp),
    },
  };

  if (firstSeen.redemet && firstSeen.tgftp) {
    const winners = Object.entries(firstSeen)
      .map(([source, hit]) => [source, hit.fetchedAt])
      .sort((a, b) => a[1] - b[1]);
    summary.winner = winners[0][0];
    summary.leadsMs = Object.fromEntries(
      winners.slice(1).map(([source, seenAt]) => [source, seenAt - winners[0][1]]),
    );
  }

  console.log(JSON.stringify({ summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
