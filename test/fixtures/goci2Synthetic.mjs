// SYNTHETIC GOCI-II fixture. No NOSC data is used or downloaded here: the grid
// is an ideal geostationary scan at 128.2° E with RKSI placed at the measured
// S007 row 541 / column 1449, and the scene is invented (sea, land, one cloud).
// Response layouts follow Hyrax DAP2/THREDDS conventions and must be checked
// against one real S007 .das/.dds before activation (docs/seoul-goci2.md).
import { earthSunDistanceAu, goci2Geometry, rayleighOpticalDepth, rayleighSphericalAlbedo } from "../../convex/lib/seoulGoci2Image.js";
import { classifyGoci2Url } from "../../convex/lib/seoulGoci2Source.js";

export const FIXTURE_ROWS = 2780, FIXTURE_COLUMNS = 2780;
export const FIXTURE_NOMINAL = Date.parse("2026-10-30T02:15:30Z");
export const FIXTURE_START = Date.parse("2026-10-30T02:27:16Z"), FIXTURE_END = Date.parse("2026-10-30T02:28:20Z");
export const FIXTURE_DAY = "GOCI-II/2026/10/30/L1B_COMP", FIXTURE_DIRECTORY = "GK2_GC2_L1B_20261030_021530";
export const fixtureFile = slot => `GK2_GOCI2_L1B_20261030_021530_LA_${slot}.nc`;
export const fixtureKey = (slot = "S007", directory = FIXTURE_DIRECTORY, day = FIXTURE_DAY) => `${day}/${directory}/${directory.replace("GK2_GC2_L1B_", "GK2_GOCI2_L1B_")}_LA_${slot}.nc`;
const FILL_FLOAT = -999, FILL_COUNT = 4294967295, SCALE = 1e-6;
const DELTA = 0.25 / 35785.863, SUB_LONGITUDE = 128.2, RS = 42164, A = 6378.137, B = 6356.7523;
const BANDS = [380, 412, 443, 490, 510, 555, 620, 660, 680, 709, 745, 865];
const F0 = { 443: 1885, 555: 1840, 660: 1545 };

function scanAngles(latitude, longitude) {
  const lat = latitude * Math.PI / 180, delta = (longitude - SUB_LONGITUDE) * Math.PI / 180;
  const e2 = 1 - (B / A) ** 2, n = A / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  const ex = n * Math.cos(lat) * Math.cos(delta), ey = n * Math.cos(lat) * Math.sin(delta), ez = n * (1 - e2) * Math.sin(lat);
  return [Math.atan2(ey, RS - ex), Math.atan2(ez, Math.hypot(RS - ex, ey))];
}
function geographic(x, y) {
  const coefficient = Math.cos(y) ** 2 + (A / B) ** 2 * Math.sin(y) ** 2;
  const discriminant = (RS * Math.cos(x) * Math.cos(y)) ** 2 - coefficient * (RS ** 2 - A ** 2);
  if (!(discriminant >= 0)) return [Number.NaN, Number.NaN];
  const sn = (RS * Math.cos(x) * Math.cos(y) - Math.sqrt(discriminant)) / coefficient;
  const sx = RS - sn * Math.cos(x) * Math.cos(y), sy = sn * Math.sin(x) * Math.cos(y), sz = sn * Math.sin(y);
  return [Math.atan2((A / B) ** 2 * sz, Math.hypot(sx, sy)) * 180 / Math.PI, SUB_LONGITUDE + Math.atan2(sy, sx) * 180 / Math.PI];
}
const [RKSI_X, RKSI_Y] = scanAngles(37.4602, 126.4407);
/** Slot S007 holds RKSI at (541, 1449); other slots are shifted far away. */
export function fixtureNavigation(row, column, slot = "S007") {
  const shift = (Number(slot.slice(1)) - 7) * 2600;
  return geographic((column - 1449 + shift) * DELTA + RKSI_X, (541 - row) * DELTA + RKSI_Y);
}

/** Invented surface reflectance: a bright cloud 20 km north of RKSI, land east
 * of 15 km and dark sea elsewhere. Radiance follows the renderer's own
 * single-scattering model, so a correct inversion recovers these values. */
export function fixtureSurface(latitude, longitude, band) {
  const x = (longitude - 126.4407) * 111.32 * Math.cos(37.4602 * Math.PI / 180), y = (latitude - 37.4602) * 111.32;
  if (Math.hypot(x, y - 20) < 12) return 0.8;
  if (x > 15) return { 660: 0.12, 555: 0.1, 443: 0.06 }[band] ?? 0.1;
  return { 660: 0.01, 555: 0.02, 443: 0.03 }[band] ?? 0.02;
}
export function fixtureCount(row, column, band, { slot = "S007", time = (FIXTURE_START + FIXTURE_END) / 2, fill } = {}) {
  if (fill?.(row, column, band)) return FILL_COUNT;
  const [latitude, longitude] = fixtureNavigation(row, column, slot);
  const f0 = F0[band] ?? 1800, tau = rayleighOpticalDepth(band), albedo = rayleighSphericalAlbedo(tau);
  const geometry = goci2Geometry(time, latitude, longitude), surface = fixtureSurface(latitude, longitude, band);
  const { cosZenith: mus, cosView: muv, cosScattering } = geometry;
  const path = 0.75 * (1 + cosScattering ** 2) / (4 * (mus + muv)) * (1 - Math.exp(-tau * (1 / mus + 1 / muv)));
  const reflectance = path + Math.exp(-tau / (2 * mus)) * Math.exp(-tau / (2 * muv)) * surface / (1 - albedo * surface);
  const radiance = reflectance * f0 * Math.max(mus, 0.01) / (Math.PI * earthSunDistanceAu(time) ** 2);
  return Math.max(0, Math.round(radiance / SCALE));
}

export function fixtureDds(slot = "S007", { omit } = {}) {
  const dims = `[number_of_lines = ${FIXTURE_ROWS}][pixels_per_line = ${FIXTURE_COLUMNS}]`;
  return ["Dataset {",
    `    Float32 /navigation_data/latitude${dims};`, `    Float32 /navigation_data/longitude${dims};`,
    ...BANDS.filter(band => band !== omit).map(band => `    UInt32 /geophysical_data/L_TOA_${band}${dims};`),
    `} ${fixtureFile(slot)};`, ""].join("\n");
}
export function fixtureDas({ start = "20261030_022716", end = "20261030_022820", units = "W m-2 um-1 sr-1", f0Attribute, nested = false } = {}) {
  const band = value => [`        String long_name "Top of Atmosphere radiance at ${value} nm";`, `        String units "${units}";`,
    `        UInt32 _FillValue ${FILL_COUNT};`, "        Float32 scale_factor 1.0E-6;", "        Float32 add_offset 0.0;",
    ...(f0Attribute && F0[value] ? [`        Float32 ${f0Attribute.name} ${f0Attribute.scale ? F0[value] * f0Attribute.scale : F0[value]};`] : [])];
  const navigation = name => [`        String long_name "${name}";`, `        String units "degrees_${name === "latitude" ? "north" : "east"}";`,
    `        Float32 _FillValue ${FILL_FLOAT}.0;`];
  const containers = nested
    ? ["    navigation_data {", "      latitude {", ...navigation("latitude"), "      }", "      longitude {", ...navigation("longitude"), "      }", "    }",
      "    geophysical_data {", ...BANDS.flatMap(value => [`      L_TOA_${value} {`, ...band(value), "      }"]), "    }"]
    : [`    /navigation_data/latitude {`, ...navigation("latitude"), "    }", `    /navigation_data/longitude {`, ...navigation("longitude"), "    }",
      ...BANDS.flatMap(value => [`    /geophysical_data/L_TOA_${value} {`, ...band(value), "    }"])];
  return ["Attributes {", ...containers, "    NC_GLOBAL {", '        String title "SYNTHETIC GOCI-II L1B test fixture";',
    `        String observation_start_time "${start}";`, `        String observation_end_time "${end}";`,
    '        String license "";', '        String publisher_name "KHOA-NOSC";', "    }", "}", ""].join("\n");
}

export function fixtureDods(hyperslab, { slot = "S007", fill, corrupt } = {}) {
  const { variable, rows, columns, shape } = hyperslab, [rowCount, columnCount] = shape;
  const float = variable.startsWith("/navigation_data/"), band = Number(variable.match(/L_TOA_(\d+)$/)?.[1]);
  const header = Buffer.from(`Dataset {\n    ${float ? "Float32" : "UInt32"} ${variable}[number_of_lines = ${rowCount}][pixels_per_line = ${columnCount}];\n} ${fixtureFile(slot)};\nData:\n`, "latin1");
  const body = Buffer.alloc(8 + 4 * rowCount * columnCount);
  body.writeUInt32BE(rowCount * columnCount, 0); body.writeUInt32BE(rowCount * columnCount, 4);
  for (let i = 0; i < rowCount; i++) for (let j = 0; j < columnCount; j++) {
    const row = rows.start + i * rows.stride, column = columns.start + j * columns.stride, offset = 8 + 4 * (i * columnCount + j);
    if (float) {
      const [latitude, longitude] = fixtureNavigation(row, column, slot), value = variable.endsWith("latitude") ? latitude : longitude;
      body.writeFloatBE(Number.isFinite(value) ? value : FILL_FLOAT, offset);
    } else body.writeUInt32BE(fixtureCount(row, column, band, { slot, fill }), offset);
  }
  const bytes = Buffer.concat([header, body]);
  return corrupt ? corrupt(bytes) : bytes;
}

export function fixtureDayCatalog(directories = [FIXTURE_DIRECTORY], day = FIXTURE_DAY) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<thredds:catalog xmlns:thredds="http://www.unidata.ucar.edu/namespaces/thredds/InvCatalog/v1.0" xmlns:xlink="http://www.w3.org/1999/xlink">
  <thredds:service name="dap" serviceType="OPeNDAP" base="/opendap/"/>
  <thredds:dataset name="/${day}" ID="/opendap/${day}/">
${directories.map(name => `    <thredds:catalogRef name="${name}" xlink:href="${name}/catalog.xml" xlink:title="${name}" xlink:type="simple"/>`).join("\n")}
  </thredds:dataset>
</thredds:catalog>`;
}
export function fixtureSlotCatalog(slots = ["S006", "S007", "S008"], directory = FIXTURE_DIRECTORY, modified = "2026-10-30T02:41:49Z") {
  const prefix = directory.replace("GK2_GC2_L1B_", "GK2_GOCI2_L1B_");
  return `<?xml version="1.0" encoding="UTF-8"?>
<thredds:catalog xmlns:thredds="http://www.unidata.ucar.edu/namespaces/thredds/InvCatalog/v1.0" xmlns:xlink="http://www.w3.org/1999/xlink">
  <thredds:dataset name="${directory}" ID="/opendap/${directory}/">
${slots.map(slot => `    <thredds:dataset name="${prefix}_LA_${slot}.nc" ID="/opendap/${prefix}_LA_${slot}.nc">
      <thredds:dataSize units="bytes">432845988</thredds:dataSize>
      <thredds:date type="modified">${modified}</thredds:date>
      <thredds:access serviceName="dap" urlPath="/${prefix}_LA_${slot}.nc"/>
    </thredds:dataset>`).join("\n")}
    <thredds:dataset name="${prefix}_LA_S007.jpg" ID="/opendap/${prefix}_LA_S007.jpg">
      <thredds:dataSize units="bytes">2400000</thredds:dataSize>
    </thredds:dataset>
  </thredds:dataset>
</thredds:catalog>`;
}

/** A fake NOSC Hyrax host for `fetch`. Every URL must pass the production allowlist. */
export function createFixtureServer({ directories = [FIXTURE_DIRECTORY], slots = ["S006", "S007", "S008"], das = fixtureDas(),
  dds = slot => fixtureDds(slot), fill, override } = {}) {
  const requests = [];
  const text = (body, kind) => ({ body: Buffer.from(body, "utf8"), kind });
  const fetch = async (input, options = {}) => {
    const href = String(input), kind = classifyGoci2Url(href);
    requests.push({ href, kind: kind?.kind ?? null, options });
    if (!kind) throw new Error(`Fixture server rejects unexpected URL ${href}`);
    const url = new URL(href), parts = url.pathname.replace(/^\/opendap\//, "").split("/");
    let response;
    if (kind.kind === "dayCatalog") response = text(fixtureDayCatalog(directories, parts.slice(0, 5).join("/")), kind.kind);
    else if (kind.kind === "directoryCatalog") response = text(fixtureSlotCatalog(slots, parts[5]), kind.kind);
    else {
      const slot = /_LA_(S\d{3})\.nc/.exec(url.pathname)[1];
      if (kind.kind === "das") response = text(das, "das");
      else if (kind.kind === "dds") response = text(dds(slot), "dds");
      else response = { body: fixtureDods(kind.hyperslab, { slot, fill }), kind: "dods", hyperslab: kind.hyperslab };
    }
    const custom = override?.({ href, kind: kind.kind, response, requests }) ?? {};
    const body = custom.body ?? response.body, headers = { "content-length": String(body.length), "last-modified": "Fri, 30 Oct 2026 02:41:49 GMT", ...custom.headers };
    return { ok: (custom.status ?? 200) === 200, status: custom.status ?? 200, headers: { get: name => headers[name.toLowerCase()] ?? null },
      body: { getReader() {
        let sent = false;
        return { async read() { await custom.onRead?.(); if (sent) return { done: true }; sent = true; return { done: false, value: new Uint8Array(body) }; },
          async cancel() { requests.at(-1).cancelled = true; } };
      } } };
  };
  return { fetch, requests };
}
