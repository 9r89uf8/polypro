import assert from "node:assert/strict";
import test from "node:test";
import { classifyGoci2Url, dasGlobal, dasNumber, dasString, dasVariable, decodeDapArray, goci2DataUrl, goci2DayCatalogUrl, goci2DayPath,
  goci2DaylightWindowOpen, goci2DirectoriesFromCatalog, goci2DirectoryCatalogUrl, goci2FilesFromCatalog, goci2Hyperslab, goci2MetadataUrl,
  parseDapDas, parseDapDds, parseGoci2Catalog, parseGoci2Clock, parseGoci2Directory, parseGoci2File, parseGoci2SourceKey,
} from "../convex/lib/seoulGoci2Source.js";
import { FIXTURE_DAY, FIXTURE_DIRECTORY, fixtureDas, fixtureDayCatalog, fixtureDds, fixtureDods, fixtureKey, fixtureSlotCatalog,
} from "./fixtures/goci2Synthetic.mjs";

test("names are discovered from catalogs, never assumed, and must agree on day, time and slot", () => {
  assert.equal(parseGoci2Clock("20261030", "021530"), Date.parse("2026-10-30T02:15:30Z"));
  assert.equal(parseGoci2Clock("20260230", "021530"), null);
  assert.equal(goci2DayPath(Date.parse("2026-10-30T23:15:30Z")), "GOCI-II/2026/10/30/L1B_COMP");
  assert.equal(parseGoci2Directory("GK2_GC2_L1B_20261030_061630", FIXTURE_DAY).nominalTimeUtc, Date.parse("2026-10-30T06:16:30Z"));
  assert.equal(parseGoci2Directory("GK2_GC2_L1B_20261031_001530", FIXTURE_DAY), null, "a directory must sit in its own UTC day");
  assert.equal(parseGoci2File("GK2_GOCI2_L1B_20261030_021530_LA_S007.nc", FIXTURE_DIRECTORY).slot, "S007");
  assert.equal(parseGoci2File("GK2_GOCI2_L1B_20261030_031530_LA_S007.nc", FIXTURE_DIRECTORY), null);
  assert.equal(parseGoci2File("GK2_GOCI2_L1B_20261030_021530_LA.nc", FIXTURE_DIRECTORY), null, "the 4.7 GB mosaic is never a candidate");
  const identity = parseGoci2SourceKey(fixtureKey());
  assert.deepEqual([identity.slot, identity.directory, identity.dayPath], ["S007", FIXTURE_DIRECTORY, FIXTURE_DAY]);
  for (const key of [fixtureKey().replace("/10/30/", "/10/31/"), `../${fixtureKey()}`, fixtureKey().replace("L1B_COMP", "L2"), "x".repeat(300)]) {
    assert.equal(parseGoci2SourceKey(key), null, key);
  }
});

test("THREDDS catalogs yield slot directories and LA slot files with provenance only", () => {
  const day = parseGoci2Catalog(fixtureDayCatalog(["GK2_GC2_L1B_20261030_011530", FIXTURE_DIRECTORY, "GK2_GC2_L1B_20261030_061630", "not_a_slot"]));
  assert.deepEqual(goci2DirectoriesFromCatalog(day, FIXTURE_DAY).map(row => row.name),
    ["GK2_GC2_L1B_20261030_061630", FIXTURE_DIRECTORY, "GK2_GC2_L1B_20261030_011530"]);
  const files = goci2FilesFromCatalog(parseGoci2Catalog(fixtureSlotCatalog(["S007", "S006"])), FIXTURE_DIRECTORY);
  assert.deepEqual(files.map(file => file.slot), ["S006", "S007"], "the quick-look JPG is ignored");
  assert.equal(files[1].size, 432845988);
  assert.equal(files[1].modifiedAt, Date.parse("2026-10-30T02:41:49Z"));
  const withoutZone = fixtureSlotCatalog(["S007"], FIXTURE_DIRECTORY, "2026-10-30T02:41:49");
  assert.equal(goci2FilesFromCatalog(parseGoci2Catalog(withoutZone), FIXTURE_DIRECTORY)[0].modifiedAt, Date.parse("2026-10-30T02:41:49Z"));
  for (const malformed of ["<html>login</html>", fixtureDayCatalog().slice(0, -20), `<!DOCTYPE x [<!ENTITY a "b">]>${fixtureDayCatalog()}`]) {
    assert.throws(() => parseGoci2Catalog(malformed), /catalog/);
  }
  const duplicate = fixtureSlotCatalog(["S007", "S007"]);
  assert.throws(() => goci2FilesFromCatalog(parseGoci2Catalog(duplicate), FIXTURE_DIRECTORY), /duplicate/);
});

test("DDS and DAS parsers read Hyrax group paths, flat or nested, and reject malformed text", () => {
  const dds = parseDapDds(fixtureDds());
  assert.deepEqual(dds.variables.get("/navigation_data/latitude"), { type: "Float32", shape: [2780, 2780], dimensions: ["number_of_lines", "pixels_per_line"] });
  assert.equal(dds.variables.get("/geophysical_data/L_TOA_660").type, "UInt32");
  assert.throws(() => parseDapDds("Error {\n code = 404;\n};"), /dataset/);
  assert.throws(() => parseDapDds(fixtureDds().replace(/\} GK2[^\n]*\n$/, "")), /truncated/);
  for (const nested of [false, true]) {
    const das = parseDapDas(fixtureDas({ nested }));
    const band = dasVariable(das, "/geophysical_data/L_TOA_660");
    assert.equal(dasNumber(band, "scale_factor"), 1e-6);
    assert.equal(dasNumber(band, "_FillValue"), 4294967295);
    assert.equal(dasString(band, "units"), "W m-2 um-1 sr-1");
    assert.equal(dasNumber(dasVariable(das, "/navigation_data/latitude"), "_FillValue"), -999);
    assert.equal(dasString(dasGlobal(das), "observation_start_time"), "20261030_022716");
    assert.equal(dasString(dasGlobal(das), "license"), "");
  }
  const escaped = parseDapDas('Attributes {\n NC_GLOBAL {\n String title "a \\"quoted\\" name";\n Float32 range 1.5, 2.5;\n }\n}');
  assert.equal(dasString(dasGlobal(escaped), "title"), 'a "quoted" name');
  assert.equal(dasNumber(dasGlobal(escaped), "range"), null, "multi-valued attributes are not scalars");
  for (const malformed of ["Attributes {", 'Attributes { NC_GLOBAL { String title "open; } }', "Attributes { } trailing"]) {
    assert.throws(() => parseDapDas(malformed), /DAS/);
  }
});

test("DAP2 arrays require the exact constrained variable, type, shape and XDR length", () => {
  const hyperslab = goci2Hyperslab("/navigation_data/latitude", { start: 540, stride: 1, stop: 542 }, { start: 1448, stride: 1, stop: 1450 });
  const bytes = fixtureDods(hyperslab), expected = { variable: hyperslab.variable, type: "Float32", shape: [3, 3] };
  const values = decodeDapArray(new Uint8Array(bytes), expected);
  assert.ok(values[0] > values[3] && values[3] > values[6], "latitude decreases with row");
  assert.ok(Math.abs(values[4] - 37.4602) < 1e-5);
  assert.throws(() => decodeDapArray(new Uint8Array(bytes.subarray(0, -4)), expected), /length/);
  assert.throws(() => decodeDapArray(new Uint8Array(Buffer.concat([bytes, Buffer.alloc(4)])), expected), /length/);
  assert.throws(() => decodeDapArray(new Uint8Array(bytes), { ...expected, shape: [3, 4] }), /shape/);
  assert.throws(() => decodeDapArray(new Uint8Array(bytes), { ...expected, type: "UInt32" }), /type/);
  assert.throws(() => decodeDapArray(new Uint8Array(bytes), { ...expected, variable: "/navigation_data/longitude" }), /variable/);
  const badCount = Buffer.from(bytes); badCount.writeUInt32BE(8, badCount.indexOf("Data:\n") + 6);
  assert.throws(() => decodeDapArray(new Uint8Array(badCount), expected), /length mismatch/);
  assert.throws(() => decodeDapArray(new Uint8Array(Buffer.from("Error {\n message = \"denied\";\n};")), expected), /marker/);
});

test("request allowlist accepts only canonical NOSC catalog, metadata and bounded subset URLs", () => {
  const key = fixtureKey(), slab = goci2Hyperslab("/geophysical_data/L_TOA_443", { start: 386, stride: 1, stop: 696 }, { start: 1233, stride: 1, stop: 1665 });
  assert.equal(classifyGoci2Url(goci2DayCatalogUrl(FIXTURE_DAY)).kind, "dayCatalog");
  assert.equal(classifyGoci2Url(goci2DirectoryCatalogUrl(FIXTURE_DAY, FIXTURE_DIRECTORY)).kind, "directoryCatalog");
  assert.equal(classifyGoci2Url(goci2MetadataUrl(key, "das")).kind, "das");
  assert.equal(classifyGoci2Url(goci2MetadataUrl(key, "dds")).kind, "dds");
  const data = classifyGoci2Url(goci2DataUrl(key, slab));
  assert.equal(data.kind, "dods");
  assert.equal(data.limit, 16 * 1024 + 8 + 4 * 311 * 433);
  assert.match(goci2DataUrl(key, slab), /\.nc\.dods\?%2Fgeophysical_data%2FL_TOA_443%5B386:1:696%5D%5B1233:1:1665%5D$/);
  const rejected = [
    goci2DataUrl(key, slab).replace("https://nosc.go.kr", "https://www.nosc.go.kr"),
    goci2DataUrl(key, slab).replace("https://", "http://"),
    goci2DataUrl(key, slab).replace("%2F", "/"),
    goci2DataUrl(key, slab).replace("L_TOA_443", "L_TOA_865"),
    goci2DataUrl(key, slab) + ",%2Fnavigation_data%2Flatitude%5B0:1:1%5D%5B0:1:1%5D",
    `https://nosc.go.kr/opendap/${key}`, `https://nosc.go.kr/opendap/${key}.dods`, `https://nosc.go.kr/opendap/${key}.ascii?x`,
    `https://user:pass@nosc.go.kr/opendap/${FIXTURE_DAY}/catalog.xml`, `https://nosc.go.kr/opendap/${FIXTURE_DAY}/catalog.xml?x=1`,
    `https://nosc.go.kr/opendap/${key}.das#x`, "https://nosc.go.kr/opendap/GOCI-II/2026/10/30/L1B_COMP/../catalog.xml", "not a url",
    `https://nosc.go.kr/opendap/${key}.dods?%E0%A4%A`,
  ];
  for (const href of rejected) assert.equal(classifyGoci2Url(href), null, href);
  assert.throws(() => goci2Hyperslab("/geophysical_data/L_TOA_443", { start: 0, stride: 1, stop: 2779 }, { start: 0, stride: 1, stop: 2779 }), /bound/);
  assert.throws(() => goci2Hyperslab("/geophysical_data/L_TOA_443", { start: 5, stride: 0, stop: 6 }, { start: 0, stride: 1, stop: 1 }), /hyperslab/);
});

test("polling is limited to daylight plus the publication delay after it", () => {
  assert.equal(goci2DaylightWindowOpen(Date.parse("2026-10-30T03:00:00Z")), true, "noon KST");
  assert.equal(goci2DaylightWindowOpen(Date.parse("2026-10-30T10:00:00Z")), true, "about two hours after sunset");
  assert.equal(goci2DaylightWindowOpen(Date.parse("2026-10-30T15:00:00Z")), false, "midnight KST");
  assert.equal(goci2DaylightWindowOpen(Date.parse("2026-10-30T22:00:00Z")), false, "07:00 KST before useful sun");
});
