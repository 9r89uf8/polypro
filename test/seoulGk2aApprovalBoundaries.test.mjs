import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const collectorSource = await readFile(
  new URL("../convex/seoulGk2aCollector.js", import.meta.url),
  "utf8",
);
const solarSource = await readFile(
  new URL("../convex/seoulGk2a.js", import.meta.url),
  "utf8",
);

function exportedBlock(source, exportName, nextExportName) {
  const start = source.indexOf(`export const ${exportName}`);
  const end = source.indexOf(`export const ${nextExportName}`, start + 1);
  assert.notEqual(start, -1, `${exportName} export must exist`);
  assert.notEqual(
    end,
    -1,
    `${nextExportName} export must follow ${exportName}`,
  );
  return source.slice(start, end);
}

test("collector-status writes fail closed when NMSC approval changes", () => {
  const block = exportedBlock(
    collectorSource,
    "writeCollectorStatus",
    "collectSolarHeating",
  );

  assert.match(block, /const approvalActive = hasApprovedNmscAccess\(\)/);
  assert.match(
    block,
    /const statusFields = approvalActive\s*\?\s*requestedStatusFields\s*:\s*\{/,
  );
  assert.match(block, /status: COLLECTOR_STATUS\.UNCONFIGURED/);
  assert.match(block, /configured: false/);
  assert.match(block, /status: "access_not_approved"/);
});

test("legacy GK2A row upsert retains an exact approval gate", () => {
  const block = exportedBlock(
    solarSource,
    "upsertSolarObservations",
    "recordCollectorStatus",
  );

  assert.match(block, /if \(!hasApprovedNmscAccess\(\)\)/);
  assert.match(block, /status: "access_not_approved"/);
  assert.match(block, /rowCount: 0/);
});

test("legacy GK2A collector-status writes fail closed", () => {
  const block = exportedBlock(
    solarSource,
    "recordCollectorStatus",
    "pollLatestSolarHeating",
  );

  assert.match(block, /if \(!hasApprovedNmscAccess\(\)\)/);
  assert.match(block, /configured: false/);
  assert.match(block, /status: "access_not_approved"/);
});
