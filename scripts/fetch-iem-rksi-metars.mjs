import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

// Downloads open Iowa Environmental Mesonet (IEM) RKSI METARs, one KST calendar
// year per sequential request, into a new directory with a hashed manifest.
// IEM files the :00 reports as type 3 and the :30 reports as type 4; the drift
// builder keeps only reports timed exactly on :00 and :30.
const [outDir, firstYearText, endDate] = process.argv.slice(2);
if (!outDir || !/^\d{4}$/.test(firstYearText ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate ?? '')) {
  throw new Error('Usage: node scripts/fetch-iem-rksi-metars.mjs <new-output-dir> <first-year> <end-date-exclusive YYYY-MM-DD>');
}
const source = 'https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py';
const fields = ['tmpc', 'dwpc', 'drct', 'sknt', 'vsby', 'skyc1', 'skyc2', 'skyc3', 'wxcodes', 'metar'];
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
await fs.mkdir(outDir); // Refuses an existing directory rather than mixing downloads.

const manifest = { source, station: 'RKSI', network: 'KR__ASOS', timeZone: 'Asia/Seoul', endDateExclusive: endDate, files: [] };
for (let year = Number(firstYearText); year <= endYear; year += 1) {
  const end = year === endYear ? [endYear, endMonth, endDay] : [year + 1, 1, 1];
  if (end.join('-') === `${year}-1-1`) break;
  const url = new URL(source);
  url.searchParams.set('station', 'RKSI');
  url.searchParams.set('network', 'KR__ASOS');
  for (const field of fields) url.searchParams.append('data', field);
  for (const [key, value] of [['year1', year], ['month1', 1], ['day1', 1], ['year2', end[0]], ['month2', end[1]], ['day2', end[2]],
    ['tz', 'Asia/Seoul'], ['format', 'onlycomma'], ['latlon', 'no'], ['missing', 'M'], ['trace', 'T'], ['direct', 'no']]) {
    url.searchParams.set(key, String(value));
  }
  url.searchParams.append('report_type', '3');
  url.searchParams.append('report_type', '4');
  const requestedAt = new Date().toISOString();
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000), headers: { 'User-Agent': 'polypro-rksi-drift-research/1.0' } });
  if (!response.ok) throw new Error(`IEM returned HTTP ${response.status} for ${year}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.toString('utf8', 0, 64).startsWith('station,valid,tmpc,')) throw new Error(`Unexpected IEM response for ${year}.`);
  const file = `rksi-${year}.csv`;
  await fs.writeFile(path.join(outDir, file), bytes, { flag: 'wx' });
  manifest.files.push({ file, url: url.href, requestedAt, bytes: bytes.length, sha256: sha256(bytes) });
  console.log(`${file}: ${bytes.length} bytes`);
}
await fs.writeFile(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
