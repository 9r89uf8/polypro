import fs from "node:fs/promises";
import path from "node:path";

const AEROESCUTA_PAGE_URL =
  process.env.SBGR_ATIS_PAGE_URL ??
  "https://aeroescuta.com.br/sample-page/fonias-guarulhos-gru/";
const TGFTP_URL =
  "https://tgftp.nws.noaa.gov/data/observations/metar/stations/SBGR.TXT";
const OUTPUT_DIR =
  process.env.SBGR_ATIS_OUTPUT_DIR ?? "/tmp/sbgr-atis-samples";
const SAMPLE_MS = Number(process.env.SBGR_ATIS_SAMPLE_MS ?? 30_000);
const INTERVAL_MS = Number(process.env.SBGR_ATIS_INTERVAL_MS ?? SAMPLE_MS);
const TOTAL_MS = Number(process.env.SBGR_ATIS_TOTAL_MS ?? 20 * 60_000);
const STATIC_STREAM_URL = process.env.SBGR_ATIS_STREAM_URL ?? "";
const REDISCOVER_EACH_SAMPLE =
  String(process.env.SBGR_ATIS_REDISCOVER_EACH_SAMPLE ?? "true").toLowerCase() !==
  "false";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatUtcStamp(epochMs) {
  const date = new Date(epochMs);
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}-${pad2(
    date.getUTCHours(),
  )}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`;
}

function formatIso(epochMs) {
  return Number.isFinite(epochMs) ? new Date(epochMs).toISOString() : null;
}

function parseHttpTimestamp(value) {
  const epochMs = Date.parse(String(value ?? "").trim());
  return Number.isFinite(epochMs) ? epochMs : null;
}

function parseSqlTimestampFromTgftpLine(value) {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})$/.exec(
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
    0,
    0,
  );
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#038;/g, "&")
    .replace(/&#8211;/g, "-");
}

function extractAtisStreamUrl(pageHtml) {
  const match =
    /ESCUTA DO ATIS DE GUARULHOS[\s\S]*?<iframe[^>]+src="([^"]+)"/i.exec(
      String(pageHtml ?? ""),
    );
  if (!match) {
    throw new Error("Could not find the Aeroescuta SBGR ATIS iframe.");
  }

  const iframeSrc = decodeHtmlEntities(match[1]);
  const iframeUrl = new URL(iframeSrc);
  const streamUrl = iframeUrl.searchParams.get("stream");
  if (!streamUrl) {
    throw new Error("Aeroescuta SBGR ATIS iframe did not include a stream URL.");
  }

  return {
    iframeSrc,
    streamUrl: decodeHtmlEntities(streamUrl),
  };
}

async function fetchCurrentAtisSource() {
  if (STATIC_STREAM_URL && !REDISCOVER_EACH_SAMPLE) {
    return {
      pageFetchedAt: null,
      iframeSrc: null,
      streamUrl: STATIC_STREAM_URL,
    };
  }

  const response = await fetch(AEROESCUTA_PAGE_URL, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  const pageFetchedAt = Date.now();
  if (!response.ok) {
    throw new Error(`Aeroescuta page fetch failed (${response.status}).`);
  }
  const html = await response.text();
  const parsed = extractAtisStreamUrl(html);
  return {
    pageFetchedAt,
    iframeSrc: parsed.iframeSrc,
    streamUrl: STATIC_STREAM_URL || parsed.streamUrl,
  };
}

async function fetchLatestTgftp() {
  const response = await fetch(TGFTP_URL, {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache" },
  });
  const fetchedAt = Date.now();
  if (!response.ok) {
    throw new Error(`tgftp latest fetch failed (${response.status}).`);
  }
  const text = (await response.text()).replace(/\r/g, "").trim();
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    throw new Error(`Unexpected tgftp response: ${text.slice(0, 160)}`);
  }
  const reportTsUtc = parseSqlTimestampFromTgftpLine(lines[0]);
  if (!Number.isFinite(reportTsUtc)) {
    throw new Error(`Unexpected tgftp timestamp line: ${lines[0]}`);
  }
  return {
    fetchedAt,
    reportTsUtc,
    rawMetar: lines.slice(1).join(" ").trim(),
    lastModifiedAt: parseHttpTimestamp(response.headers.get("last-modified")),
  };
}

async function captureAtisSample({ streamUrl, outputDir, sampleMs }) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const response = await fetch(streamUrl, {
    cache: "no-store",
    headers: {
      "Cache-Control": "no-cache",
      "Icy-MetaData": "1",
    },
    signal: controller.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`ATIS stream fetch failed (${response.status}).`);
  }

  const reader = response.body.getReader();
  const deadline = startedAt + sampleMs;
  const chunks = [];
  let totalBytes = 0;
  let finishedNaturally = false;

  try {
    while (Date.now() < deadline) {
      const timeLeftMs = deadline - Date.now();
      if (timeLeftMs <= 0) {
        break;
      }

      const result = await Promise.race([
        reader.read(),
        sleep(timeLeftMs).then(() => ({ timedOut: true })),
      ]);

      if (result?.timedOut) {
        break;
      }

      if (result.done) {
        finishedNaturally = true;
        break;
      }

      const chunk = Buffer.from(result.value);
      chunks.push(chunk);
      totalBytes += chunk.byteLength;
    }
  } finally {
    controller.abort();
    try {
      await reader.cancel();
    } catch {
      // Ignore reader shutdown errors on abort.
    }
  }

  const endedAt = Date.now();
  const fileName = `sbgr-atis-${formatUtcStamp(startedAt)}-${Math.max(
    1,
    Math.round((endedAt - startedAt) / 1000),
  )}s.mp3`;
  const filePath = path.join(outputDir, fileName);
  await fs.writeFile(filePath, Buffer.concat(chunks));

  return {
    filePath,
    startedAt,
    endedAt,
    totalBytes,
    finishedNaturally,
    headers: {
      contentType: response.headers.get("content-type"),
      icyBr: response.headers.get("icy-br"),
      icyMetaInt: response.headers.get("icy-metaint"),
      icyName: response.headers.get("icy-name"),
    },
  };
}

async function appendJsonLine(filePath, value) {
  await fs.appendFile(filePath, `${JSON.stringify(value)}\n`, "utf8");
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  const manifestPath = path.join(OUTPUT_DIR, "manifest.jsonl");

  console.log(`# SBGR ATIS capture starting`);
  console.log(
    JSON.stringify(
      {
        aeroescutaPageUrl: AEROESCUTA_PAGE_URL,
        outputDir: OUTPUT_DIR,
        sampleMs: SAMPLE_MS,
        intervalMs: INTERVAL_MS,
        totalMs: TOTAL_MS,
        staticStreamUrl: STATIC_STREAM_URL || null,
        rediscoverEachSample: REDISCOVER_EACH_SAMPLE,
      },
      null,
      2,
    ),
  );

  const runStartedAt = Date.now();
  let sampleIndex = 0;
  let currentSource = null;

  while (Date.now() - runStartedAt < TOTAL_MS) {
    sampleIndex += 1;
    const cycleStartedAt = Date.now();

    try {
      if (!currentSource || REDISCOVER_EACH_SAMPLE) {
        currentSource = await fetchCurrentAtisSource();
      }

      const tgftp = await fetchLatestTgftp().catch((error) => ({
        error: error instanceof Error ? error.message : String(error),
      }));

      const sample = await captureAtisSample({
        streamUrl: currentSource.streamUrl,
        outputDir: OUTPUT_DIR,
        sampleMs: SAMPLE_MS,
      });

      const record = {
        sampleIndex,
        pageFetchedAt: formatIso(currentSource.pageFetchedAt),
        iframeSrc: currentSource.iframeSrc,
        streamUrl: currentSource.streamUrl,
        sampleStartedAt: formatIso(sample.startedAt),
        sampleEndedAt: formatIso(sample.endedAt),
        sampleDurationSec: Math.round((sample.endedAt - sample.startedAt) / 1000),
        bytes: sample.totalBytes,
        finishedNaturally: sample.finishedNaturally,
        outputFile: sample.filePath,
        streamHeaders: sample.headers,
        tgftp:
          tgftp.error
            ? { error: tgftp.error }
            : {
                fetchedAt: formatIso(tgftp.fetchedAt),
                reportTsUtc: formatIso(tgftp.reportTsUtc),
                rawMetar: tgftp.rawMetar,
                lastModifiedAt: formatIso(tgftp.lastModifiedAt),
              },
      };

      await appendJsonLine(manifestPath, record);

      console.log(
        JSON.stringify(
          {
            sampleIndex,
            sampleStartedAt: record.sampleStartedAt,
            bytes: record.bytes,
            outputFile: path.basename(record.outputFile),
            tgftpReportTsUtc: record.tgftp.reportTsUtc ?? null,
            tgftpLastModifiedAt: record.tgftp.lastModifiedAt ?? null,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const record = {
        sampleIndex,
        failedAt: formatIso(Date.now()),
        error: message,
      };
      await appendJsonLine(manifestPath, record);
      console.error(`# Sample ${sampleIndex} failed: ${message}`);
    }

    const cycleElapsedMs = Date.now() - cycleStartedAt;
    const sleepMs = INTERVAL_MS - cycleElapsedMs;
    if (sleepMs > 0 && Date.now() - runStartedAt < TOTAL_MS) {
      await sleep(sleepMs);
    }
  }

  console.log(`# SBGR ATIS capture finished`);
  console.log(`# Manifest: ${manifestPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
