import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CAPMA_APPROVAL_FLAGS,
  capmaAftnAccessApproved,
  capmaTdzApprovalState,
} from "../convex/mexicoCapmaApprovals.js";

const CANONICAL_FLAGS = Object.values(CAPMA_APPROVAL_FLAGS).map(
  ({ canonical }) => canonical,
);

test("canonical CAPMA approval names fit Convex's environment-name limit", () => {
  assert.deepEqual(CANONICAL_FLAGS, [
    "SENEAM_MMMX_AFTN_ACCESS_APPROVED",
    "SENEAM_MMMX_TDZ_ACCESS_APPROVED",
    "SENEAM_MMMX_TDZ_RETENTION_APPROVED",
    "SENEAM_MMMX_TDZ_REPUBLICATION_APPROVED",
  ]);
  for (const name of CANONICAL_FLAGS) {
    assert.ok(name.length <= 40, `${name} must not exceed 40 characters`);
  }
});

test("CAPMA approval aliases accept only the exact string true", () => {
  assert.equal(capmaAftnAccessApproved({}), false);
  assert.equal(
    capmaAftnAccessApproved({ SENEAM_MMMX_AFTN_ACCESS_APPROVED: "TRUE" }),
    false,
  );
  assert.equal(
    capmaAftnAccessApproved({ SENEAM_MMMX_AFTN_ACCESS_APPROVED: "true" }),
    true,
  );
  assert.equal(
    capmaAftnAccessApproved({
      SENEAM_CAPMA_MMMX_AFTN_REPORTS_ACCESS_APPROVED: "true",
    }),
    true,
  );
  assert.equal(
    capmaAftnAccessApproved({
      SENEAM_MMMX_AFTN_ACCESS_APPROVED: "false",
      SENEAM_CAPMA_MMMX_AFTN_REPORTS_ACCESS_APPROVED: "true",
    }),
    false,
  );
});

test("TDZ canonical and legacy gates have identical fail-closed semantics", () => {
  assert.deepEqual(capmaTdzApprovalState({}), {
    accessApproved: false,
    retentionApproved: false,
    republicationApproved: false,
    collectionApproved: false,
    publicationApproved: false,
  });

  const canonical = capmaTdzApprovalState({
    SENEAM_MMMX_TDZ_ACCESS_APPROVED: "true",
    SENEAM_MMMX_TDZ_RETENTION_APPROVED: "true",
    SENEAM_MMMX_TDZ_REPUBLICATION_APPROVED: "true",
  });
  assert.equal(canonical.collectionApproved, true);
  assert.equal(canonical.publicationApproved, true);

  const legacy = capmaTdzApprovalState({
    SENEAM_CAPMA_MMMX_TDZ_IMAGES_ACCESS_APPROVED: "true",
    SENEAM_CAPMA_MMMX_TDZ_IMAGES_RETENTION_APPROVED: "true",
    SENEAM_CAPMA_MMMX_TDZ_DATA_REPUBLICATION_APPROVED: "true",
  });
  assert.equal(legacy.collectionApproved, true);
  assert.equal(legacy.publicationApproved, true);

  const malformed = capmaTdzApprovalState({
    SENEAM_MMMX_TDZ_ACCESS_APPROVED: "true",
    SENEAM_MMMX_TDZ_RETENTION_APPROVED: "TRUE",
    SENEAM_MMMX_TDZ_REPUBLICATION_APPROVED: "true",
  });
  assert.equal(malformed.collectionApproved, false);
  assert.equal(malformed.publicationApproved, false);

  const stagedMigration = capmaTdzApprovalState({
    SENEAM_MMMX_TDZ_ACCESS_APPROVED: "true",
    SENEAM_CAPMA_MMMX_TDZ_IMAGES_RETENTION_APPROVED: "true",
    SENEAM_MMMX_TDZ_REPUBLICATION_APPROVED: "true",
  });
  assert.equal(stagedMigration.publicationApproved, true);

  const canonicalDenialWins = capmaTdzApprovalState({
    SENEAM_MMMX_TDZ_ACCESS_APPROVED: "false",
    SENEAM_CAPMA_MMMX_TDZ_IMAGES_ACCESS_APPROVED: "true",
    SENEAM_MMMX_TDZ_RETENTION_APPROVED: "true",
    SENEAM_MMMX_TDZ_REPUBLICATION_APPROVED: "true",
  });
  assert.equal(canonicalDenialWins.publicationApproved, false);

  const malformedCanonicalDenialWins = capmaTdzApprovalState({
    SENEAM_MMMX_TDZ_ACCESS_APPROVED: "TRUE",
    SENEAM_CAPMA_MMMX_TDZ_IMAGES_ACCESS_APPROVED: "true",
    SENEAM_MMMX_TDZ_RETENTION_APPROVED: "true",
    SENEAM_MMMX_TDZ_REPUBLICATION_APPROVED: "true",
  });
  assert.equal(malformedCanonicalDenialWins.publicationApproved, false);
});

test("all CAPMA-protected Convex entry points use the centralized gates", async () => {
  const entryPoints = [
    "mexico.js",
    "mexicoCapma.js",
    "mexicoCapmaNode.js",
    "mexicoCapmaAftn.js",
    "mexicoRelayRace.js",
    "mexicoEdge.js",
    "mexicoEdgeWatch.js",
    "http.js",
  ];
  const sources = await Promise.all(
    entryPoints.map(async (filename) => ({
      filename,
      source: await readFile(
        new URL(`../convex/${filename}`, import.meta.url),
        "utf8",
      ),
    })),
  );

  for (const { filename, source } of sources) {
    assert.match(
      source,
      /mexicoCapmaApprovals\.js/,
      `${filename} must import the centralized CAPMA approvals`,
    );
    assert.doesNotMatch(
      source,
      /process\.env\.SENEAM_CAPMA_MMMX_/,
      `${filename} must not bypass canonical-or-legacy exact-true checks`,
    );
  }
});
