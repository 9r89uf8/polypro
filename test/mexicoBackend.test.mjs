import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import test from "node:test";
import { gzipSync } from "node:zlib";
import jpeg from "jpeg-js";

import { resolveConvexSiteOrigin } from "../app/mexico/convex-site.js";

import {
  normalizeAwcMetarItem,
  normalizeTafPeriod,
  optionalFiniteNumber,
  parseTafTemperatureGroups,
} from "../convex/mexico.js";
import {
  normalizeSmnRow,
  parseSmnHourlyGzipStream,
  parseSmnLocalHour,
} from "../convex/mexicoForecastNode.js";
import { extractCapmaDisplayFromPixels } from "../convex/mexicoCapmaOcr.js";
import {
  capmaStorageDigestMatches,
  decideCapmaLatestImageUpdate,
} from "../convex/mexicoCapma.js";
import {
  buildCapmaMetarSimilarity,
  CAPMA_METAR_WINDOW_MS,
  resolveCapmaComparisonAnchor,
  selectCapmaBracket,
} from "../convex/mexicoCapmaSimilarity.js";

test("CAPMA image URLs stay on the same hosted Convex deployment as data", () => {
  assert.equal(
    resolveConvexSiteOrigin(
      "https://rapid-greyhound-887.convex.cloud",
      "https://groovy-elephant-131.convex.site",
    ),
    "https://rapid-greyhound-887.convex.site",
  );
  assert.equal(
    resolveConvexSiteOrigin(
      "https://rapid-greyhound-887.convex.cloud/path?ignored=true",
      null,
    ),
    "https://rapid-greyhound-887.convex.site",
  );
  assert.equal(
    resolveConvexSiteOrigin(
      "https://self-hosted.example.com",
      "https://images.example.com/path",
    ),
    "https://images.example.com",
  );
  assert.equal(
    resolveConvexSiteOrigin("http://unsafe.example.com", "javascript:alert(1)"),
    null,
  );
});

function capmaSimilarityRow({
  tdz = "05",
  screenTimeUtc,
  currentTempC = 20,
  twoMinuteTempC = currentTempC,
  firstSeenAt = screenTimeUtc + 15_000,
  fetchCompletedAt = screenTimeUtc + 20_000,
  rawHash = `${tdz}-${screenTimeUtc}`,
} = {}) {
  return {
    tdz,
    screenTimeUtc,
    screenTimeLocal: new Date(screenTimeUtc).toISOString(),
    currentTempC,
    twoMinuteTempC,
    firstSeenAt,
    fetchCompletedAt,
    rawHash,
    ocrConfidence: 0.9,
  };
}

test("CAPMA comparison brackets AWC receipt across midnight within two minutes", () => {
  const receiptTimeUtc = Date.parse("2026-08-05T06:01:00Z");
  const metarRow = {
    stationIcao: "MMMX",
    reportKey: "midnight-report",
    rawHash: "midnight-report",
    reportType: "METAR",
    obsTimeUtc: Date.parse("2026-08-05T05:50:00Z"),
    obsTimeLocal: "2026-08-04 23:50:00",
    reportTimeUtc: receiptTimeUtc - 30 * 60_000,
    initialAwcReceiptTimeUtc: receiptTimeUtc,
    firstSeenAt: receiptTimeUtc + 30_000,
    tempC: 20,
  };
  assert.deepEqual(resolveCapmaComparisonAnchor(metarRow, "release"), {
    timeUtc: receiptTimeUtc,
    kind: "awc_receipt",
  });
  const capmaRows = [
    capmaSimilarityRow({
      screenTimeUtc: receiptTimeUtc - CAPMA_METAR_WINDOW_MS,
      currentTempC: 20,
    }),
    capmaSimilarityRow({
      screenTimeUtc: receiptTimeUtc + CAPMA_METAR_WINDOW_MS,
      currentTempC: 21,
    }),
  ];
  const bracket = selectCapmaBracket(
    capmaRows,
    "05",
    receiptTimeUtc,
    metarRow.tempC,
  );
  assert.ok(bracket, "23:59 and 00:03 must bracket a 00:01 receipt");
  assert.equal(bracket.before.offsetSeconds, -120);
  assert.equal(bracket.after.offsetSeconds, 120);

  const similarity = buildCapmaMetarSimilarity({
    metarRows: [metarRow],
    capmaRows,
    anchorMode: "release",
    nowMs: receiptTimeUtc + CAPMA_METAR_WINDOW_MS + 1,
  });
  assert.equal(similarity.eligibleReportCount, 1);
  assert.equal(similarity.matchingReportCount, 1);
  assert.equal(similarity.similarityPct, 100);
  assert.equal(similarity.displaySimilarityPct, null);
  assert.equal(similarity.meanAbsoluteErrorC, 0.5);
});

test("CAPMA comparison is same-TDZ, strict after, live, and one vote per report", () => {
  const anchor = Date.parse("2026-08-05T12:01:00Z");
  const metarRows = [
    {
      stationIcao: "MMMX",
      reportKey: "original",
      rawHash: "original",
      reportType: "SPECI",
      obsTimeUtc: anchor - 10 * 60_000,
      obsTimeLocal: "2026-08-05 05:51:00",
      firstSeenAt: anchor - 1_000,
      tempC: 15,
    },
    {
      stationIcao: "MMMX",
      reportKey: "correction",
      rawHash: "correction",
      reportType: "SPECI",
      obsTimeUtc: anchor - 10 * 60_000,
      obsTimeLocal: "2026-08-05 05:51:00",
      isCorrection: true,
      firstSeenAt: anchor,
      tempC: 20,
    },
  ];
  const capmaRows = [
    capmaSimilarityRow({ screenTimeUtc: anchor, currentTempC: 20 }),
    capmaSimilarityRow({
      screenTimeUtc: anchor + 60_000,
      currentTempC: 20,
    }),
    capmaSimilarityRow({
      tdz: "23",
      screenTimeUtc: anchor - 60_000,
      currentTempC: 24,
    }),
    capmaSimilarityRow({
      tdz: "23",
      screenTimeUtc: anchor + 60_000,
      currentTempC: 20,
      fetchCompletedAt: anchor + 5 * 60_000,
    }),
    capmaSimilarityRow({
      screenTimeUtc: anchor + CAPMA_METAR_WINDOW_MS + 1,
      currentTempC: 30,
    }),
  ];
  const similarity = buildCapmaMetarSimilarity({
    metarRows,
    capmaRows,
    anchorMode: "release",
    nowMs: anchor + CAPMA_METAR_WINDOW_MS + 1,
  });
  assert.equal(similarity.distinctOfficialReportCount, 1);
  assert.equal(similarity.eligibleReportCount, 1);
  assert.equal(similarity.matchingReportCount, 1);
  assert.equal(similarity.recentComparisons[0].readingCount, 2);
  assert.equal(similarity.recentComparisons[0].tdzCount, 1);
  assert.equal(similarity.recentComparisons[0].exactMatch, true);
});

test("CAPMA similarity waits for the full after-window and publishes after ten reports", () => {
  const anchor = Date.parse("2026-08-05T18:01:00Z");
  const rows = Array.from({ length: 10 }, (_, index) => ({
    stationIcao: "MMMX",
    reportKey: `report-${index}`,
    rawHash: `report-${index}`,
    reportType: "METAR",
    obsTimeUtc: anchor + index * 10 * 60_000,
    obsTimeLocal: `2026-08-05 ${String(12 + Math.floor(index / 6)).padStart(2, "0")}:00:00`,
    firstSeenAt: anchor + index * 10 * 60_000,
    tempC: 20,
  }));
  const capmaRows = rows.flatMap((row, index) => [
    capmaSimilarityRow({
      screenTimeUtc: row.firstSeenAt - 60_000,
      currentTempC: 20,
      rawHash: `before-${index}`,
    }),
    capmaSimilarityRow({
      screenTimeUtc: row.firstSeenAt + 60_000,
      currentTempC: index === 9 ? 22 : 20,
      rawHash: `after-${index}`,
    }),
  ]);
  const pending = buildCapmaMetarSimilarity({
    metarRows: rows.slice(0, 1),
    capmaRows,
    anchorMode: "release",
    nowMs: anchor + CAPMA_METAR_WINDOW_MS - 1,
  });
  assert.equal(pending.pendingReportCount, 1);
  assert.equal(pending.eligibleReportCount, 0);

  const mature = buildCapmaMetarSimilarity({
    metarRows: rows,
    capmaRows,
    anchorMode: "release",
    nowMs: rows.at(-1).firstSeenAt + CAPMA_METAR_WINDOW_MS + 1,
  });
  assert.equal(mature.eligibleReportCount, 10);
  assert.equal(mature.matchingReportCount, 9);
  assert.equal(mature.similarityPct, 90);
  assert.equal(mature.displaySimilarityPct, 90);
  assert.equal(mature.maturity, "provisional");
});

test("SMN local hours use the required source offset without null coercion", () => {
  const parsed = parseSmnLocalHour("20260803T18", "6");
  assert.equal(parsed.forecastTimeUtc, Date.parse("2026-08-04T00:00:00Z"));
  assert.equal(parsed.forecastTimeLocal, "2026-08-03 18:00:00");
  assert.equal(parsed.utcOffsetHours, 6);

  assert.equal(parseSmnLocalHour("20260803T18", null), null);
  assert.equal(parseSmnLocalHour("20260803T18", ""), null);
  assert.equal(parseSmnLocalHour("20260230T18", "6"), null);
  assert.equal(parseSmnLocalHour("20260803T18", "15"), null);
  assert.equal(parseSmnLocalHour("20260803T18", 0).utcOffsetHours, 0);
});

test("SMN rows reject a missing temperature and preserve valid zero values", () => {
  const baseRow = {
    ides: "9",
    idmun: "17",
    nmun: "Venustiano Carranza",
    hloc: "20260803T18",
    dh: "6",
    desciel: "Lluvia",
  };

  assert.equal(normalizeSmnRow({ ...baseRow, temp: null }), null);
  const row = normalizeSmnRow({
    ...baseRow,
    temp: "0",
    prec: "0",
    probprec: 0,
    hr: null,
    dpt: "",
    velvien: 0,
    dirvieng: null,
    raf: "0",
  });
  assert.equal(row.tempC, 0);
  assert.equal(row.tempF, 32);
  assert.equal(row.precipitationMm, 0);
  assert.equal(row.precipitationProbabilityPct, 0);
  assert.equal(row.windSpeedKph, 0);
  assert.equal(row.windGustKph, 0);
  assert.equal(row.conditionKey, "rain");
  assert.equal("humidityPct" in row, false);
  assert.equal("dewpointC" in row, false);
  assert.equal("windDirectionDeg" in row, false);
});

test("SMN gzip parser handles arbitrary chunks, escapes, and nested objects", async () => {
  const rows = [
    {
      ides: "9",
      idmun: "17",
      nmun: "Venustiano Carranza",
      desciel: 'Nublado {con texto \\"citado\\"}',
      nested: { note: "a brace } inside a string" },
    },
    { ides: "9", idmun: "99", nmun: "Otra alcaldía" },
    { ides: 9, idmun: 17, nmun: "Venustiano Carranza" },
  ];
  const jsonText = ` \n${JSON.stringify(rows)}\r\n\t`;
  const compressed = gzipSync(Buffer.from(jsonText, "utf8"));
  const chunks = [];
  for (let index = 0; index < compressed.length; index += 7) {
    chunks.push(compressed.subarray(index, index + 7));
  }

  const result = await parseSmnHourlyGzipStream(Readable.from(chunks));
  assert.equal(result.compressedBytes, compressed.length);
  assert.equal(
    result.rawHash,
    createHash("sha256").update(compressed).digest("hex"),
  );
  assert.equal(result.decompressedBytes, Buffer.byteLength(jsonText));
  assert.equal(result.totalObjectCount, 3);
  assert.equal(result.targetRows.length, 2);
  assert.deepEqual(result.targetRows[0], rows[0]);
});

test("SMN gzip parser requires one complete JSON root array", async () => {
  const parseText = (text) =>
    parseSmnHourlyGzipStream(
      Readable.from([gzipSync(Buffer.from(text, "utf8"))]),
    );

  await assert.rejects(
    parseText('{"ides":"9","idmun":"17"}'),
    /root must open with an array/i,
  );
  await assert.rejects(
    parseText('[{"ides":"9","idmun":"17"}'),
    /complete JSON root array/i,
  );
  await assert.rejects(
    parseText('[{"ides":"9","idmun":"17"},]'),
    /trailing comma/i,
  );
  await assert.rejects(
    parseText('[{"ides":"9","idmun":"17"}] trailing'),
    /non-whitespace data after the root array/i,
  );
});

test("SMN gzip parser propagates incomplete JSON as a stream failure", async () => {
  const compressed = gzipSync(Buffer.from('[{"ides":"9","idmun":"17"', "utf8"));
  await assert.rejects(
    parseSmnHourlyGzipStream(Readable.from([compressed])),
    /ended inside a JSON object/i,
  );
});

test("AWC optional numbers distinguish missing values from zero", () => {
  assert.equal(optionalFiniteNumber(null), undefined);
  assert.equal(optionalFiniteNumber(undefined), undefined);
  assert.equal(optionalFiniteNumber("  "), undefined);
  assert.equal(optionalFiniteNumber("not-a-number"), undefined);
  assert.equal(optionalFiniteNumber(0), 0);
  assert.equal(optionalFiniteNumber("0"), 0);

  const nullable = normalizeTafPeriod({
    timeFrom: "2026-08-04T00:00:00Z",
    timeTo: "2026-08-04T03:00:00Z",
    probability: null,
    visib: null,
    wdir: null,
    wspd: null,
    clouds: [{ cover: "BKN", base: null }],
  });
  assert.equal(nullable.cloudSummary, "BKN");
  assert.equal("probability" in nullable, false);
  assert.equal("visibilitySm" in nullable, false);
  assert.equal("windDirectionDeg" in nullable, false);
  assert.equal("windSpeedKt" in nullable, false);

  const zero = normalizeTafPeriod({
    timeFrom: 1785801600,
    timeTo: 1785812400,
    probability: 0,
    visib: 0,
    wdir: 0,
    wspd: 0,
  });
  assert.equal(zero.probability, 0);
  assert.equal(zero.visibilitySm, 0);
  assert.equal(zero.windDirectionDeg, 0);
  assert.equal(zero.windSpeedKt, 0);
});

test("AWC preserves auditable METAR rows when decoded temperature is missing", async () => {
  const collection = {
    stationIcao: "MMMX",
    fetchStartedAt: Date.parse("2026-08-04T00:00:08Z"),
    fetchCompletedAt: Date.parse("2026-08-04T00:00:09Z"),
  };
  const baseItem = {
    icaoId: "MMMX",
    receiptTime: "2026-08-04T00:00:07.401Z",
    obsTime: 1785800700,
    reportTime: "2026-08-04T00:00:00.000Z",
    metarType: "METAR",
    rawOb: "METAR MMMX 032345Z 03018KT 9SM VCRA BKN020CB RMK TEST",
  };

  const missing = await normalizeAwcMetarItem(
    { ...baseItem, temp: null },
    collection,
  );
  assert.ok(missing);
  assert.equal(missing.rawMetar, baseItem.rawOb);
  assert.equal(missing.obsTimeUtc, 1785800700000);
  assert.equal("tempC" in missing, false);
  assert.equal("tempF" in missing, false);

  const zero = await normalizeAwcMetarItem(
    { ...baseItem, temp: 0 },
    collection,
  );
  assert.equal(zero.tempC, 0);
  assert.equal(zero.tempF, 32);
});

test("TAF TX/TN groups resolve across a month boundary", () => {
  const groups = parseTafTemperatureGroups(
    "TAF MMMX 311700Z 3118/0218 TX25/0119Z TNM02/0108Z",
    Date.parse("2026-07-31T18:00:00Z"),
    Date.parse("2026-08-02T18:00:00Z"),
  );
  assert.deepEqual(
    groups.map(({ kind, tempC, forecastTimeUtc }) => ({
      kind,
      tempC,
      forecastTimeUtc,
    })),
    [
      {
        kind: "maximum",
        tempC: 25,
        forecastTimeUtc: Date.parse("2026-08-01T19:00:00Z"),
      },
      {
        kind: "minimum",
        tempC: -2,
        forecastTimeUtc: Date.parse("2026-08-01T08:00:00Z"),
      },
    ],
  );
});

test("CAPMA OCR matches all manually transcribed image captures when fixtures exist", async (t) => {
  const fixtureDirectory = new URL("../tmp/capma-metar-test/", import.meta.url);
  let csv;
  try {
    csv = await readFile(
      new URL("display-transcription.csv", fixtureDirectory),
      "utf8",
    );
  } catch (error) {
    if (error?.code === "ENOENT") {
      t.skip("local CAPMA image fixtures are not present");
      return;
    }
    throw error;
  }

  const [headerLine, ...dataLines] = csv.trim().split(/\r?\n/).filter(Boolean);
  const headers = headerLine.split(",");
  const fixtures = dataLines.map((line) =>
    Object.fromEntries(
      line.split(",").map((value, index) => [headers[index], value]),
    ),
  );
  assert.equal(fixtures.length, 21);

  for (const fixture of fixtures) {
    const tdzMatch = /^pista(05|23)-/.exec(fixture.savedPath);
    assert.ok(tdzMatch, `fixture has a TDZ filename: ${fixture.savedPath}`);
    const expectedTdz = tdzMatch[1];
    const expectedScreenTimeUtc = Date.parse(fixture.screenUtc);
    const jpegBytes = await readFile(
      new URL(fixture.savedPath, fixtureDirectory),
    );
    const decoded = jpeg.decode(jpegBytes, {
      useTArray: true,
      formatAsRGBA: true,
    });
    const extracted = extractCapmaDisplayFromPixels(decoded, {
      expectedTdz,
      fetchedAt: expectedScreenTimeUtc + 5 * 60 * 1000,
    });

    assert.equal(extracted.tdz, expectedTdz, fixture.savedPath);
    assert.equal(
      extracted.screenTimeUtc,
      expectedScreenTimeUtc,
      fixture.savedPath,
    );
    assert.equal(
      extracted.currentTempC,
      Number(fixture.currentTempC),
      fixture.savedPath,
    );
    assert.equal(
      extracted.twoMinuteTempC,
      Number(fixture.twoMinTempC),
      fixture.savedPath,
    );
  }
});

test("CAPMA latest-image selection is monotonic and deterministic", () => {
  const incoming = { rawHash: "incoming", screenTimeUtc: 200 };

  assert.equal(
    decideCapmaLatestImageUpdate({
      current: null,
      currentStorageValid: false,
      incoming,
    }),
    "insert_first",
  );
  for (const currentStorageValid of [true, false]) {
    assert.equal(
      decideCapmaLatestImageUpdate({
        current: { rawHash: "newer", screenTimeUtc: 300 },
        currentStorageValid,
        incoming,
      }),
      "keep_newer_current",
    );
  }
  assert.equal(
    decideCapmaLatestImageUpdate({
      current: { rawHash: "incoming", screenTimeUtc: 200 },
      currentStorageValid: true,
      incoming,
    }),
    "keep_unchanged",
  );
  assert.equal(
    decideCapmaLatestImageUpdate({
      current: { rawHash: "other", screenTimeUtc: 200 },
      currentStorageValid: true,
      incoming,
    }),
    "keep_equal_timestamp_current",
  );
  assert.equal(
    decideCapmaLatestImageUpdate({
      current: { rawHash: "other", screenTimeUtc: 200 },
      currentStorageValid: false,
      incoming,
    }),
    "repair_equal_timestamp",
  );
  assert.equal(
    decideCapmaLatestImageUpdate({
      current: { rawHash: "older", screenTimeUtc: 100 },
      currentStorageValid: true,
      incoming,
    }),
    "replace_with_newer",
  );
  assert.equal(
    decideCapmaLatestImageUpdate({
      current: { rawHash: "older", screenTimeUtc: 100 },
      currentStorageValid: false,
      incoming,
    }),
    "repair_with_newer",
  );
});

test("CAPMA storage digest validation accepts Convex hex and base64 representations", () => {
  const digest = createHash("sha256").update("CAPMA digest fixture").digest();
  const rawHash = digest.toString("hex");
  const expectedStorageSha256 = digest.toString("base64");

  assert.equal(rawHash.length, 64);
  assert.equal(expectedStorageSha256.length, 44);
  assert.equal(
    capmaStorageDigestMatches({
      actualStorageSha256: expectedStorageSha256,
      expectedStorageSha256,
      rawHash,
    }),
    true,
  );
  assert.equal(
    capmaStorageDigestMatches({
      actualStorageSha256: rawHash,
      expectedStorageSha256,
      rawHash,
    }),
    true,
  );
  assert.equal(
    capmaStorageDigestMatches({
      actualStorageSha256: "not-the-same-digest",
      expectedStorageSha256,
      rawHash,
    }),
    false,
  );
});

test("CAPMA approval checks bracket queueing, requests, decoding, storage, and reads", async () => {
  const [queueSource, workerSource, dashboardSource, schemaSource, httpSource] =
    await Promise.all([
      readFile(new URL("../convex/mexicoCapma.js", import.meta.url), "utf8"),
      readFile(
        new URL("../convex/mexicoCapmaNode.js", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../convex/mexico.js", import.meta.url), "utf8"),
      readFile(new URL("../convex/schema.js", import.meta.url), "utf8"),
      readFile(new URL("../convex/http.js", import.meta.url), "utf8"),
    ]);

  assert.match(queueSource, /=== "true"/);
  assert.match(
    queueSource,
    /if \(!gates\.accessApproved \|\| !gates\.retentionApproved\)[\s\S]*?ctx\.scheduler\.runAfter/,
  );
  assert.match(
    queueSource,
    /storeCapmaObservation[\s\S]*?if \(!gates\.accessApproved \|\| !gates\.retentionApproved\)/,
  );

  const requestGate = workerSource.indexOf(
    'assertGates("the external request")',
  );
  const fetchCall = workerSource.indexOf("const response = await fetch");
  const responseGate = workerSource.indexOf('assertGates("response handling")');
  const bodyRead = workerSource.indexOf("response.arrayBuffer()");
  const decodeGate = workerSource.indexOf('assertGates("JPEG validation")');
  const imageStoreGate = workerSource.indexOf(
    'assertGates("protected raw JPEG storage")',
  );
  const imageStoreCall = workerSource.indexOf("ctx.storage.store");
  assert.doesNotMatch(
    workerSource,
    /\{\s*sha256:\s*rawHash\s*\}/,
    "Convex 1.32 rejects the hex metadata hash as an HTTP Digest upload option",
  );
  assert.match(
    workerSource,
    /const digest = createHash\("sha256"\)\.update\(body\)\.digest\(\);[\s\S]*?digest\.toString\("hex"\)[\s\S]*?digest\.toString\("base64"\)/,
  );
  assert.match(workerSource, /\{ sha256: expectedStorageSha256 \}/);
  const storeGate = workerSource.indexOf(
    'assertGates("protected row and image metadata storage")',
  );
  const storeCall = workerSource.indexOf(
    "internal.mexicoCapma.storeCapmaObservation",
  );
  assert.ok(
    requestGate < fetchCall &&
      fetchCall < responseGate &&
      responseGate < bodyRead &&
      bodyRead < decodeGate &&
      decodeGate < imageStoreGate &&
      imageStoreGate < imageStoreCall &&
      imageStoreCall < storeGate &&
      decodeGate < storeGate &&
      storeGate < storeCall,
  );

  const cleanupGuard = workerSource.indexOf(
    "uploadedStorageId && !imageMetadataCommitted",
  );
  const cleanupCall = workerSource.indexOf(
    "internal.mexicoCapma.deleteUploadIfUnreferenced",
  );
  assert.ok(storeCall < cleanupGuard && cleanupGuard < cleanupCall);
  assert.doesNotMatch(
    workerSource,
    /uploadedStorageId && !imageMetadataCommitted[\s\S]*?ctx\.storage\.delete\(uploadedStorageId\)/,
  );

  assert.match(queueSource, /ctx\.db\.system\.get\(\s*"_storage"/);
  assert.match(queueSource, /expectedStorageSha256: v\.string\(\)/);
  assert.match(queueSource, /storageSha256: uploadedMetadata\.sha256/);
  assert.match(
    queueSource,
    /currentStorageMetadata\.sha256 === currentLatest\.storageSha256/,
  );
  assert.equal(
    queueSource.match(/metadata\.sha256 !== row\.storageSha256/g)?.length,
    2,
  );
  const observationStore = queueSource.indexOf(
    "const observationId = existing",
  );
  const latestDecision = queueSource.indexOf(
    "decideCapmaLatestImageUpdate({",
    observationStore,
  );
  const staleUploadDelete = queueSource.indexOf(
    "await ctx.storage.delete(args.latestImage.storageId)",
    latestDecision,
  );
  assert.ok(
    observationStore < latestDecision && latestDecision < staleUploadDelete,
    "historical OCR must be retained before a stale latest-image upload is discarded",
  );
  assert.match(
    queueSource,
    /ctx\.db\.patch\(currentLatest\._id,[\s\S]*?storageId: args\.latestImage\.storageId,[\s\S]*?ctx\.storage\.delete\(currentLatest\.storageId\)/,
  );
  assert.match(
    queueSource,
    /deleteUploadIfUnreferenced[\s\S]*?withIndex\("by_storage_id"[\s\S]*?if \(reference\)[\s\S]*?ctx\.storage\.delete\(args\.storageId\)/,
  );
  assert.match(
    workerSource,
    /if \(latestImageState && previousStatus\?\.etag\)/,
  );
  assert.match(
    workerSource,
    /if \(latestImageState && previousStatus\?\.lastModified\)/,
  );
  assert.match(
    workerSource,
    /fetch\(config\.url, \{[\s\S]*?redirect: "manual"/,
  );
  const notModifiedResponse = workerSource.indexOf(
    "if (response.status === 304)",
  );
  const redirectRejection = workerSource.indexOf(
    "if (response.status >= 300 && response.status < 400)",
  );
  assert.ok(
    notModifiedResponse < redirectRejection,
    "304 must be the sole accepted cache-validation 3xx response",
  );

  const latestSchema = schemaSource.slice(
    schemaSource.indexOf("mexicoCapmaLatestImages: defineTable"),
  );
  assert.match(latestSchema, /storageId: v\.id\("_storage"\)/);
  assert.match(latestSchema, /storageSha256: v\.string\(\)/);
  assert.match(
    latestSchema,
    /\.index\("by_station_tdz", \["stationIcao", "tdz"\]\)/,
  );
  assert.match(latestSchema, /\.index\("by_storage_id", \["storageId"\]\)/);
  assert.match(
    schemaSource,
    /\.index\("by_station_screen_time", \["stationIcao", "screenTimeUtc"\]\)/,
  );

  assert.match(
    dashboardSource,
    /capmaVisible\s*=\s*capmaAccessApproved\s*&&\s*capmaRetentionApproved\s*&&\s*capmaRepublicationApproved/,
  );
  assert.match(dashboardSource, /const capmaRows = capmaVisible\s*\?/);
  assert.match(
    dashboardSource,
    /if \(capmaVisible\)[\s\S]*?query\("mexicoCapmaLatestImages"\)[\s\S]*?"\/mexico\/capma\/latest-image"/,
  );
  assert.doesNotMatch(dashboardSource, /ctx\.storage\.getUrl/);
  assert.match(
    dashboardSource,
    /storageMetadata\.sha256 !== row\.storageSha256/,
  );
  assert.doesNotMatch(dashboardSource, /process\.env\.CONVEX_SITE_URL/);
  assert.match(dashboardSource, /latestImages: capmaLatestImages/);
  assert.match(
    dashboardSource,
    /if \(capmaVisible\)[\s\S]*?by_station_screen_time[\s\S]*?buildCapmaMetarSimilarity/,
  );
  assert.match(dashboardSource, /metarSimilarity: capmaMetarSimilarity/);

  const httpRoute = httpSource.slice(
    httpSource.indexOf('path: "/mexico/capma/latest-image"'),
    httpSource.indexOf('path: "/twilio/recording"'),
  );
  assert.match(httpRoute, /getLatestImageForHttp/);
  assert.match(httpRoute, /ctx\.storage\.get\(image\.storageId\)/);
  assert.match(httpRoute, /"Cache-Control": "private, no-store, max-age=0"/);
  assert.ok(
    httpRoute.split("capmaPublicImageApproved()").length - 1 >= 3,
    "the image proxy must recheck publication gates around its storage read",
  );
});

test("Mexico chart has one METAR/SPECI series and one CAPMA live series", async () => {
  const pageSource = await readFile(
    new URL("../app/mexico/day/[date]/page.js", import.meta.url),
    "utf8",
  );
  const chartSource = pageSource.slice(
    pageSource.indexOf("const chartData = useMemo"),
    pageSource.indexOf("const chartHasData"),
  );
  assert.equal(
    chartSource.split("buildCapmaChartPoints(").length - 1,
    1,
    "the chart must emit one CAPMA dataset",
  );
  assert.match(chartSource, /CAPMA live temperature · TDZ/);
  assert.match(chartSource, /Official MMMX METAR \/ SPECI · AWC/);
  assert.doesNotMatch(chartSource, /legacy AWOS display · TDZ/);

  const temperatureOptionsStart = pageSource.lastIndexOf(
    "const chartOptions = useMemo",
  );
  const temperatureOptionsSource = pageSource.slice(
    temperatureOptionsStart,
    pageSource.indexOf("const scrollChartToMinute", temperatureOptionsStart),
  );
  const legendSource = temperatureOptionsSource.slice(
    temperatureOptionsSource.indexOf("plugins: {"),
    temperatureOptionsSource.indexOf("tooltip: {"),
  );
  const tooltipSource = temperatureOptionsSource.slice(
    temperatureOptionsSource.indexOf("tooltip: {"),
    temperatureOptionsSource.indexOf("scales: {"),
  );
  assert.match(legendSource, /legend: \{\s*display: false/);
  assert.match(tooltipSource, /raw\.sourceRole === "capma"/);
  assert.doesNotMatch(tooltipSource, /raw\.sourceRole === "capma(?:05|23)"/);
  assert.match(tooltipSource, /Embedded screen:/);
  assert.match(tooltipSource, /Two-minute display:/);
  assert.match(tooltipSource, /OCR confidence:/);
  assert.match(pageSource, /● METAR \/ SPECI/);
  assert.match(pageSource, /━ CAPMA live temperature/);
});

test("Mexico collectors use canonical status keys and one-minute minimum cooldowns", async () => {
  const [awcSource, smnSource, capmaSource, schemaSource] = await Promise.all([
    readFile(new URL("../convex/mexico.js", import.meta.url), "utf8"),
    readFile(
      new URL("../convex/mexicoForecastNode.js", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../convex/mexicoCapmaNode.js", import.meta.url), "utf8"),
    readFile(new URL("../convex/schema.js", import.meta.url), "utf8"),
  ]);

  assert.match(awcSource, /const AWC_COOLDOWN_MS = 60_000;/);
  assert.match(capmaSource, /const COOLDOWN_MS = 60_000;/);
  assert.match(smnSource, /const SOURCE = "smn_municipal_hourly";/);
  assert.doesNotMatch(smnSource, /const SOURCE = "smn_hourly";/);

  const validatorBlock = awcSource.slice(
    awcSource.indexOf("const metarRowValidator"),
    awcSource.indexOf("export const upsertMetarBatch"),
  );
  const schemaBlock = schemaSource.slice(
    schemaSource.indexOf("mexicoMetarObservations: defineTable"),
    schemaSource.indexOf("mexicoTafForecasts: defineTable"),
  );
  for (const block of [validatorBlock, schemaBlock]) {
    assert.match(block, /tempC: v\.optional\(v\.number\(\)\)/);
    assert.match(block, /tempF: v\.optional\(v\.number\(\)\)/);
  }
});
