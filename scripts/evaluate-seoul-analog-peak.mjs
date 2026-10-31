import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ANALOG_LIBRARY, ANALOG_LIBRARY_VERSION } from '../convex/lib/seoulAnalogPeakLibrary.js';
import { ANALOG_PEAK_CHECKPOINTS, ANALOG_PEAK_MODEL_VERSION, buildAnalogPeak, scoreAnalogPeak } from '../convex/lib/seoulAnalogPeakModel.js';

// Offline evaluation of the production analog peak model over its own
// library. Each target day is forecast from days at least 183 days away, so its
// own season (and the days around it) never serve as analogs. No requests.
const [output] = process.argv.slice(2);
if (!output) throw new Error('Usage: node scripts/evaluate-seoul-analog-peak.mjs <new-output.json>');
const seasonOf = date => ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'][Number(date.slice(5, 7)) - 1];
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const library = ANALOG_LIBRARY;

const results = {};
for (const checkpoint of Object.keys(ANALOG_PEAK_CHECKPOINTS)) {
  const groups = {};
  for (let index = 0; index < library.dates.length; index += 1) {
    const vector = library.checkpoints[checkpoint].vectors[index];
    if (!vector) continue;
    const date = library.dates[index];
    const features = { tempC: library.checkpoints[checkpoint].tempC[index], maxSoFarC: library.checkpoints[checkpoint].maxSoFarC[index], vector };
    const forecast = buildAnalogPeak({ library, date, checkpoint, features, excludeWithinDays: 183 });
    if (!forecast) continue;
    const score = scoreAnalogPeak(forecast, { maxC: library.maxC[index], peakFirstSlot: library.peakFirstSlot[index] });
    for (const key of ['all', seasonOf(date)]) {
      const group = (groups[key] ??= { days: 0, analog: [], season: [], analogWidth: 0, seasonWidth: 0 });
      group.days += 1;
      group.analog.push(score.analog);
      group.season.push(score.season);
      group.analogWidth += forecast.analog.peakFirstMinutes[2] - forecast.analog.peakFirstMinutes[0];
      group.seasonWidth += forecast.season.peakFirstMinutes[2] - forecast.season.peakFirstMinutes[0];
    }
  }
  const mean = (rows, pick) => rows.reduce((sum, row) => sum + pick(row), 0) / rows.length;
  const summarize = (rows, width, days) => ({
    peakMaeMinutes: Number(mean(rows, row => row.peakErrorMinutes).toFixed(1)),
    interval10to90Coverage: Number(mean(rows, row => row.covered ? 1 : 0).toFixed(3)),
    intervalWidthMinutes: Number((width / days).toFixed(1)),
    brierPeakAhead: Number(mean(rows, row => row.brierPeakAhead).toFixed(4)),
    maxMaeC: Number(mean(rows, row => row.maxErrorC).toFixed(3)),
    maxExactShare: Number(mean(rows, row => row.maxErrorC === 0 ? 1 : 0).toFixed(3)),
  });
  results[checkpoint] = Object.fromEntries(['all', 'winter', 'spring', 'summer', 'autumn'].map(key => {
    const group = groups[key];
    return [key, { days: group.days, analog: summarize(group.analog, group.analogWidth, group.days), season: summarize(group.season, group.seasonWidth, group.days) }];
  }));
}

const evidence = {
  generatedAt: new Date().toISOString(), modelVersion: ANALOG_PEAK_MODEL_VERSION, libraryVersion: ANALOG_LIBRARY_VERSION,
  method: 'Every library day with checkpoint features is a target; analogs come only from days at least 183 days away. Season = all same-window days without conditioning.',
  sources: {
    scriptSha256: sha256(await fs.readFile(fileURLToPath(import.meta.url))),
    modelSha256: sha256(await fs.readFile(fileURLToPath(new URL('../convex/lib/seoulAnalogPeakModel.js', import.meta.url)))),
    librarySha256: sha256(await fs.readFile(fileURLToPath(new URL('../convex/lib/seoulAnalogPeakLibrary.js', import.meta.url)))),
  },
  results,
};
await fs.writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
for (const [checkpoint, seasons] of Object.entries(results)) {
  console.log(`\n${checkpoint} KST  (analog vs season)`);
  for (const [key, { days, analog: a, season: s }] of Object.entries(seasons)) {
    console.log(`${key.padEnd(7)} ${String(days).padStart(5)} | peak MAE ${a.peakMaeMinutes} vs ${s.peakMaeMinutes} min | 10-90% ${(100 * a.interval10to90Coverage).toFixed(0)}% vs ${(100 * s.interval10to90Coverage).toFixed(0)}%, width ${a.intervalWidthMinutes} vs ${s.intervalWidthMinutes} | ahead Brier ${a.brierPeakAhead} vs ${s.brierPeakAhead} | max MAE ${a.maxMaeC} vs ${s.maxMaeC}, exact ${(100 * a.maxExactShare).toFixed(0)}% vs ${(100 * s.maxExactShare).toFixed(0)}%`);
  }
}
