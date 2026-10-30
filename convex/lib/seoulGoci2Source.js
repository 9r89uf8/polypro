// Runtime-agnostic GOCI-II naming, catalog and OPeNDAP (DAP2) parsing.
// Nothing here performs a request; the approval-gated worker owns all I/O.
import { solarGeometry } from "./seoulGk2aCloudMath.js";

export const GOCI2_ORIGIN = "https://nosc.go.kr";
export const RKSI = Object.freeze({ latitude: 37.4602, longitude: 126.4407 });
export const GOCI2_BANDS = Object.freeze([660, 555, 443]);
export const GOCI2_VARIABLES = Object.freeze({
  latitude: "/navigation_data/latitude", longitude: "/navigation_data/longitude",
  443: "/geophysical_data/L_TOA_443", 555: "/geophysical_data/L_TOA_555", 660: "/geophysical_data/L_TOA_660",
});
export const GOCI2_MAX_WINDOW_ELEMENTS = 420 * 520;
export const GOCI2_LIMITS = Object.freeze({ catalog: 512 * 1024, das: 256 * 1024, dds: 64 * 1024, dodsHeader: 16 * 1024 });
const DAY_PATTERN = /^GOCI-II\/(\d{4})\/(\d{2})\/(\d{2})\/L1B_COMP$/;
const DIRECTORY_PATTERN = /^GK2_GC2_L1B_(\d{8})_(\d{6})$/;
const FILE_PATTERN = /^GK2_GOCI2_L1B_(\d{8})_(\d{6})_LA_(S\d{3})\.nc$/;
const MAX_FILE_BYTES = 2 * 1024 ** 3;
const ALLOWED_VARIABLES = new Set(Object.values(GOCI2_VARIABLES));
const requireValue = (condition, message) => { if (!condition) throw new Error(`GOCI-II: ${message}`); };

export function parseGoci2Clock(date, time) {
  const day = /^(\d{4})(\d{2})(\d{2})$/.exec(date ?? ""), clock = /^(\d{2})(\d{2})(\d{2})$/.exec(time ?? "");
  if (!day || !clock) return null;
  const parts = [...day.slice(1), ...clock.slice(1)].map(Number);
  const value = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]), parsed = new Date(value);
  return [parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate(), parsed.getUTCHours(),
    parsed.getUTCMinutes(), parsed.getUTCSeconds()].every((part, index) => part === parts[index]) ? value : null;
}

/** Local-area slots are daytime only and can appear up to ~2.5 h after the
 * last useful sun, so polling is limited to that window (no network outside it). */
export function goci2DaylightWindowOpen(now) {
  for (let minutes = 0; minutes <= 150; minutes += 10) {
    const elevation = solarGeometry(now - minutes * 60_000, RKSI.latitude, RKSI.longitude).solarElevationDeg;
    if (elevation !== null && elevation >= 5) return true;
  }
  return false;
}

export function goci2DayPath(time) {
  const iso = new Date(time).toISOString();
  return `GOCI-II/${iso.slice(0, 4)}/${iso.slice(5, 7)}/${iso.slice(8, 10)}/L1B_COMP`;
}

export function parseGoci2Directory(name, dayPath) {
  const match = DIRECTORY_PATTERN.exec(name ?? "");
  const nominalTimeUtc = match ? parseGoci2Clock(match[1], match[2]) : null;
  if (nominalTimeUtc === null || (dayPath !== undefined && goci2DayPath(nominalTimeUtc) !== dayPath)) return null;
  return { name, nominalTimeUtc };
}

export function parseGoci2File(name, directory) {
  const match = FILE_PATTERN.exec(name ?? ""), folder = parseGoci2Directory(directory);
  if (!match || !folder || directory !== `GK2_GC2_L1B_${match[1]}_${match[2]}`) return null;
  return { name, slot: match[3], nominalTimeUtc: folder.nominalTimeUtc };
}

/** Stable identity of one slot file: `GOCI-II/YYYY/MM/DD/L1B_COMP/<directory>/<file>`. */
export function parseGoci2SourceKey(key) {
  const parts = typeof key === "string" && key.length <= 200 ? key.split("/") : [];
  if (parts.length !== 7) return null;
  const dayPath = parts.slice(0, 5).join("/"), [directory, file] = parts.slice(5);
  const folder = DAY_PATTERN.test(dayPath) ? parseGoci2Directory(directory, dayPath) : null;
  const slotFile = folder ? parseGoci2File(file, directory) : null;
  return slotFile ? { key, dayPath, directory, file, slot: slotFile.slot, nominalTimeUtc: folder.nominalTimeUtc } : null;
}

export function goci2DayCatalogUrl(dayPath) {
  requireValue(DAY_PATTERN.test(dayPath ?? ""), "invalid day path");
  return `${GOCI2_ORIGIN}/opendap/${dayPath}/catalog.xml`;
}
export function goci2DirectoryCatalogUrl(dayPath, directory) {
  requireValue(DAY_PATTERN.test(dayPath ?? "") && parseGoci2Directory(directory, dayPath), "invalid slot directory");
  return `${GOCI2_ORIGIN}/opendap/${dayPath}/${directory}/catalog.xml`;
}
export function goci2MetadataUrl(sourceKey, suffix) {
  requireValue(parseGoci2SourceKey(sourceKey) && ["das", "dds"].includes(suffix), "invalid metadata request");
  return `${GOCI2_ORIGIN}/opendap/${sourceKey}.${suffix}`;
}

/** One DAP2 hyperslab. Group paths need an encoded leading slash on NOSC Hyrax;
 * brackets are encoded too so no proxy rejects them as raw query characters. */
export function goci2Hyperslab(variable, rows, columns) {
  requireValue(ALLOWED_VARIABLES.has(variable), "variable is not on the request allowlist");
  const shape = [rows, columns].map(({ start, stride, stop }) => {
    requireValue([start, stride, stop].every(Number.isSafeInteger) && start >= 0 && stride >= 1 && stop >= start && stop < 10_000,
      "invalid hyperslab");
    return Math.floor((stop - start) / stride) + 1;
  });
  requireValue(shape[0] * shape[1] <= GOCI2_MAX_WINDOW_ELEMENTS, "hyperslab exceeds the element bound");
  const range = ({ start, stride, stop }) => `${start}:${stride}:${stop}`;
  return { variable, rows: { ...rows }, columns: { ...columns }, shape,
    text: `${variable}[${range(rows)}][${range(columns)}]`,
    query: `${variable.replaceAll("/", "%2F")}%5B${range(rows)}%5D%5B${range(columns)}%5D` };
}
export function goci2DataUrl(sourceKey, hyperslab) {
  requireValue(parseGoci2SourceKey(sourceKey), "invalid source key");
  return `${GOCI2_ORIGIN}/opendap/${sourceKey}.dods?${hyperslab.query}`;
}

/** Request allowlist: returns the request class and response byte limit, or null. */
export function classifyGoci2Url(href) {
  let url;
  try { url = new URL(href); } catch { return null; }
  if (url.origin !== GOCI2_ORIGIN || url.username || url.password || url.hash) return null;
  const path = url.pathname;
  let match = /^\/opendap\/(GOCI-II\/\d{4}\/\d{2}\/\d{2}\/L1B_COMP)\/catalog\.xml$/.exec(path);
  if (match && !url.search && DAY_PATTERN.test(match[1])) return { kind: "dayCatalog", limit: GOCI2_LIMITS.catalog };
  match = /^\/opendap\/(GOCI-II\/\d{4}\/\d{2}\/\d{2}\/L1B_COMP)\/([^/]+)\/catalog\.xml$/.exec(path);
  if (match && !url.search && parseGoci2Directory(match[2], match[1])) return { kind: "directoryCatalog", limit: GOCI2_LIMITS.catalog };
  match = /^\/opendap\/(.+)\.(das|dds)$/.exec(path);
  if (match && !url.search && parseGoci2SourceKey(match[1])) return { kind: match[2], limit: GOCI2_LIMITS[match[2]] };
  match = /^\/opendap\/(.+)\.dods$/.exec(path);
  if (!match || !parseGoci2SourceKey(match[1]) || !url.search) return null;
  let decoded;
  try { decoded = decodeURIComponent(url.search.slice(1)); } catch { return null; }
  const constraint = /^(\/[a-z_]+\/[A-Za-z_0-9]+)\[(\d+):(\d+):(\d+)\]\[(\d+):(\d+):(\d+)\]$/.exec(decoded);
  if (!constraint) return null;
  const [, variable, ...numbers] = constraint, [r0, rs, r1, c0, cs, c1] = numbers.map(Number);
  let hyperslab;
  try { hyperslab = goci2Hyperslab(variable, { start: r0, stride: rs, stop: r1 }, { start: c0, stride: cs, stop: c1 }); } catch { return null; }
  if (`?${hyperslab.query}` !== url.search) return null; // one canonical encoding only
  return { kind: "dods", limit: GOCI2_LIMITS.dodsHeader + 8 + 4 * hyperslab.shape[0] * hyperslab.shape[1], hyperslab };
}

function xmlAttributes(source) {
  const attributes = {}, entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  for (const [, name, value] of source.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
    attributes[name] = value.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => entities[entity]);
  }
  return attributes;
}
function catalogDate(value) {
  const text = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(text)) return null;
  const parsed = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}
function catalogBytes(value, units) {
  const amount = Number(value), scale = { bytes: 1, kbytes: 1e3, mbytes: 1e6, gbytes: 1e9 }[String(units ?? "bytes").toLowerCase()];
  return Number.isFinite(amount) && scale ? Math.round(amount * scale) : null;
}

/** Hyrax THREDDS catalog: slot-directory references and file datasets. */
export function parseGoci2Catalog(text) {
  requireValue(typeof text === "string" && text.length <= GOCI2_LIMITS.catalog, "catalog is missing or oversized");
  requireValue(!/<!DOCTYPE|<!ENTITY/i.test(text) && /<(?:thredds:)?catalog\b/.test(text)
    && /<\/(?:thredds:)?catalog>\s*$/.test(text), "catalog is malformed or truncated");
  const refs = [], datasets = [];
  for (const [, body] of text.matchAll(/<(?:thredds:)?catalogRef\b([^>]*?)\/?>/g)) {
    const attributes = xmlAttributes(body), href = attributes["xlink:href"] ?? attributes.href ?? "";
    refs.push({ names: [attributes.name, attributes["xlink:title"], href.replace(/\/?catalog\.xml$/, "").split("/").filter(Boolean).at(-1)]
      .filter(Boolean) });
  }
  for (const [, head, body] of text.matchAll(/<(?:thredds:)?dataset\b([^>]*[^/])>((?:(?!<(?:thredds:)?dataset\b)[\s\S])*?)<\/(?:thredds:)?dataset>/g)) {
    const size = /<(?:thredds:)?dataSize\b([^>]*)>\s*([\d.]+)\s*<\/(?:thredds:)?dataSize>/.exec(body);
    const modified = /<(?:thredds:)?date\b[^>]*type="modified"[^>]*>([^<]*)<\/(?:thredds:)?date>/.exec(body);
    datasets.push({ name: xmlAttributes(head).name, size: size ? catalogBytes(size[2], xmlAttributes(size[1]).units) : null,
      modifiedAt: modified ? catalogDate(modified[1]) : null });
  }
  requireValue(refs.length + datasets.length <= 2000, "catalog exceeds its entry bound");
  return { refs, datasets };
}

export function goci2DirectoriesFromCatalog(catalog, dayPath) {
  const found = new Map();
  for (const ref of catalog.refs) {
    const directory = ref.names.map(name => parseGoci2Directory(name, dayPath)).find(Boolean);
    if (directory) found.set(directory.name, directory);
  }
  return [...found.values()].sort((a, b) => b.nominalTimeUtc - a.nominalTimeUtc);
}

export function goci2FilesFromCatalog(catalog, directory) {
  const found = new Map();
  for (const dataset of catalog.datasets) {
    // Size and modification time are provenance only; whole files are never downloaded.
    const file = parseGoci2File(dataset.name, directory);
    if (!file || (dataset.size !== null && (!Number.isSafeInteger(dataset.size) || dataset.size <= 0 || dataset.size > MAX_FILE_BYTES))) continue;
    requireValue(!found.has(file.slot), "duplicate slot file in one directory");
    found.set(file.slot, { ...file, ...(dataset.size !== null ? { size: dataset.size } : {}),
      ...(Number.isFinite(dataset.modifiedAt) ? { modifiedAt: dataset.modifiedAt } : {}) });
  }
  return [...found.values()].sort((a, b) => a.slot.localeCompare(b.slot));
}

/** DAP2 DDS; only top-level arrays are returned. Nested constructors are skipped. */
export function parseDapDds(text) {
  requireValue(typeof text === "string" && text.length <= GOCI2_LIMITS.dds, "DDS is missing or oversized");
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  requireValue(/^Dataset\s*\{$/.test(lines[0] ?? ""), "DDS does not start with a dataset");
  const variables = new Map();
  let depth = 1, name = null;
  for (const line of lines.slice(1)) {
    requireValue(depth > 0, "DDS has content after its dataset");
    if (/^(?:Structure|Sequence|Grid)\s*\{$/.test(line)) { depth++; continue; }
    if (/^(?:ARRAY|MAPS):$/.test(line)) continue;
    const close = /^\}\s*([^;]*);$/.exec(line);
    if (close) { if (--depth === 0) name = close[1].trim(); continue; }
    const declaration = /^(\w+)\s+([^\s[;]+)((?:\[[^\]]*\])*)\s*;$/.exec(line);
    requireValue(declaration, "malformed DDS declaration");
    if (depth !== 1) continue;
    const dimensions = [...declaration[3].matchAll(/\[\s*(?:([^=\]]+?)\s*=\s*)?(\d+)\s*\]/g)];
    requireValue(dimensions.length === (declaration[3].match(/\[/g) ?? []).length, "invalid DDS dimension");
    requireValue(!variables.has(declaration[2]), "duplicate DDS variable");
    variables.set(declaration[2], { type: declaration[1], shape: dimensions.map(dimension => Number(dimension[2])),
      dimensions: dimensions.map(dimension => dimension[1]?.trim() ?? null) });
  }
  requireValue(depth === 0 && name !== null, "DDS is truncated");
  return { name, variables };
}

function dasTokens(text) {
  const tokens = [];
  for (let index = 0; index < text.length;) {
    const character = text[index];
    if (/\s/.test(character)) { index++; continue; }
    if ("{};,".includes(character)) { tokens.push({ kind: character }); index++; continue; }
    if (character === '"') {
      let value = "", closed = false;
      for (index++; index < text.length; index++) {
        if (text[index] === "\\" && index + 1 < text.length) { value += text[++index]; continue; }
        if (text[index] === '"') { closed = true; index++; break; }
        value += text[index];
      }
      requireValue(closed, "unterminated DAS string");
      tokens.push({ kind: "string", value });
      continue;
    }
    const word = /^[^\s{};,"]+/.exec(text.slice(index, index + 512))[0];
    tokens.push({ kind: "word", value: word });
    index += word.length;
    requireValue(tokens.length <= 200_000, "DAS exceeds its token bound");
  }
  return tokens;
}

/** DAP2 DAS as nested containers: { attributes: {name: {type, values}}, containers: {name: …} }. */
export function parseDapDas(text) {
  requireValue(typeof text === "string" && text.length <= GOCI2_LIMITS.das, "DAS is missing or oversized");
  const tokens = dasTokens(text);
  let position = 0;
  const next = kind => {
    const token = tokens[position++];
    requireValue(token && (!kind || token.kind === kind), "malformed DAS");
    return token;
  };
  const container = depth => {
    requireValue(depth <= 8, "DAS nesting is too deep");
    const result = { attributes: {}, containers: {} };
    while (tokens[position]?.kind !== "}") {
      const first = next("word");
      if (tokens[position]?.kind === "{") {
        position++;
        result.containers[first.value] = container(depth + 1);
        next("}");
        continue;
      }
      const name = next("word").value, values = [];
      while (true) {
        const token = next();
        requireValue(token.kind === "string" || token.kind === "word", "malformed DAS value");
        values.push(token.value);
        if (tokens[position]?.kind !== ",") break;
        position++;
      }
      next(";");
      const numeric = /^(?:Byte|U?Int(?:8|16|32|64)|Float(?:32|64))$/.test(first.value);
      result.attributes[name] = { type: first.value, values: numeric ? values.map(Number) : values };
    }
    return result;
  };
  requireValue(next("word").value === "Attributes", "DAS does not start with Attributes");
  next("{");
  const root = container(1);
  next("}");
  requireValue(position === tokens.length, "DAS has trailing content");
  return root;
}

/** Hyrax exposes NetCDF-4 group variables either as flattened `/group/name`
 * containers or as nested group containers; accept both, nothing broader. */
export function dasVariable(das, path) {
  const flat = das.containers[path] ?? das.containers[path.replace(/^\//, "")];
  if (flat) return flat;
  let node = das;
  for (const segment of path.split("/").filter(Boolean)) {
    node = node?.containers?.[segment] ?? node?.containers?.[`/${segment}`];
    if (!node) return null;
  }
  return node;
}
export function dasGlobal(das) { return das.containers.NC_GLOBAL ?? das.containers["/"] ?? null; }
export function dasNumber(container, name) {
  const value = container?.attributes?.[name]?.values;
  return Array.isArray(value) && value.length === 1 && typeof value[0] === "number" && Number.isFinite(value[0]) ? value[0] : null;
}
export function dasString(container, name) {
  const value = container?.attributes?.[name]?.values;
  return Array.isArray(value) && value.length === 1 && typeof value[0] === "string" ? value[0] : null;
}

const DATA_MARKER = /\r?\nData:\r?\n/;
const ARRAY_TYPES = { Float32: Float32Array, UInt32: Uint32Array, Int32: Int32Array };
/** One DAP2 `.dods` array response: constrained DDS, `Data:` marker, then
 * XDR (length twice, then big-endian 4-byte values). Exact shape and size only. */
export function decodeDapArray(bytes, expected) {
  requireValue(bytes instanceof Uint8Array, "DAP2 response must be binary");
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, GOCI2_LIMITS.dodsHeader)));
  const marker = DATA_MARKER.exec(head);
  requireValue(marker, "DAP2 response has no data marker");
  const dds = parseDapDds(head.slice(0, marker.index + 1));
  const declared = dds.variables.get(expected.variable);
  requireValue(dds.variables.size === 1 && declared, "DAP2 response contains an unexpected variable");
  requireValue(declared.type === expected.type && ARRAY_TYPES[declared.type], "DAP2 response has an unexpected type");
  requireValue(declared.shape.length === 2 && declared.shape.every((size, index) => size === expected.shape[index]),
    "DAP2 response has an unexpected shape");
  const offset = marker.index + marker[0].length, count = expected.shape[0] * expected.shape[1];
  requireValue(bytes.length === offset + 8 + 4 * count, "DAP2 response length does not match its shape");
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8 + 4 * count);
  requireValue(view.getUint32(0) === count && view.getUint32(4) === count, "DAP2 array length mismatch");
  const values = new ARRAY_TYPES[declared.type](count);
  const read = declared.type === "Float32" ? "getFloat32" : declared.type === "UInt32" ? "getUint32" : "getInt32";
  for (let index = 0; index < count; index++) values[index] = view[read](8 + 4 * index);
  return values;
}
