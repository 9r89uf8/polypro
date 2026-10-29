import { runSeoulPaperProbe } from './lib/seoul-paper-probe-runner.mjs';

// One local, bounded paper capture. Immutable v2 evidence lives beside the
// explicitly mutable convenience summary. No market requests or production writes.
const [output] = process.argv.slice(2);
if (!output) throw new Error('Usage: node scripts/probe-seoul-next-metar.mjs NEW_OUTPUT.json');
await runSeoulPaperProbe({ output });
