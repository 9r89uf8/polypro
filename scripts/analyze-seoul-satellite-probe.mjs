import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Offline summary of the bounded two-source, two-prefix listing probe.
// Fresh metadata is not an accepted/decoded cloud signal or an uptime SLA.
const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node scripts/analyze-seoul-satellite-probe.mjs PROBE.json OUTPUT.json');
const raw = await fs.readFile(input), probe = JSON.parse(raw);
if (!probe.completedAtUtc || !Array.isArray(probe.polls) || probe.polls.length % 4) throw new Error('A completed four-request-cycle probe is required.');
const parse = value => { const result=Date.parse(value); if(!Number.isFinite(result))throw new Error('Invalid clock');return result; };
const nominal = (source, id) => {
  const match = source==='himawari9' ? /^(\d{12})-JP(0[1-4])$/.exec(id) : source==='gk2a' ? /^(\d{12})$/.exec(id) : null;
  if(!match)throw new Error('Invalid source/pair identity');
  const t=match[1], time=parse(`${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}T${t.slice(8,10)}:${t.slice(10,12)}:00Z`);
  if(Number(t.slice(10,12))%(source==='himawari9'?10:2)!==0)throw new Error('Unexpected nominal schedule');
  if(new Date(time).toISOString().replaceAll('-','').replace('T','').replaceAll(':','').slice(0,12)!==t)throw new Error('Invalid pair date');
  return time+(source==='himawari9'?(Number(match[2])-1)*150_000:0);
};
const median = numbers => { const a=[...numbers].sort((x,y)=>x-y), n=a.length;return n?(a[Math.floor((n-1)/2)]+a[Math.floor(n/2)])/2:null; };
const identities = new Set();
for(const row of probe.arrivals){
  const id=`${row.source}:${row.pairId}`;
  if(identities.has(id))throw new Error('Repeated arrival; classify reappearances separately');
  identities.add(id);
  const time=nominal(row.source,row.pairId);
  if(parse(row.nominalSlotUtc)!==time)throw new Error('Nominal slot disagreement');
  const lower=(parse(row.previousAbsentListingStartedUtc)-time)/1000;
  const upper=(parse(row.firstSeenUtc)-time)/1000;
  if(lower>upper || Math.abs(lower-row.appearanceDelayLowerSec)>1e-6 || Math.abs(upper-row.appearanceDelayUpperSec)>1e-6)throw new Error('Invalid arrival bracket');
  const patterns=row.source==='himawari9'?[/_B03_JP0[1-4]_R05_S0101\.DAT\.bz2$/,/\_B13_JP0[1-4]_R20_S0101\.DAT\.bz2$/]:[/_vi006_la005ge_\d{12}\.nc$/,/\_ir105_la020ge_\d{12}\.nc$/];
  if(!patterns[0].test(row.visible.key)||!patterns[1].test(row.infrared.key))throw new Error('Unexpected band resolution');
}
const snapshots=[];
for(let i=0;i<probe.polls.length;i+=4){
  const cycle=probe.polls.slice(i,i+4), starts=cycle.map(p=>parse(p.requestStartedUtc));
  if(Math.max(...starts)-Math.min(...starts)>1000)throw new Error('Unexpected cycle request grouping');
  const cycleAt=Math.max(...cycle.map(p=>parse(p.completedUtc)));
  for(const source of ['himawari9','gk2a']){
    const polls=cycle.filter(p=>p.source===source);
    if(polls.length!==2 || new Set(polls.map(p=>p.prefix)).size!==2)throw new Error('Expected two distinct prefixes per source');
    if(polls.some(p=>p.error)){
      snapshots.push({cycle:i/4,source,atUtc:new Date(cycleAt).toISOString(),status:'unscored_request_error'});continue;
    }
    const pairs=[...new Set(polls.flatMap(p=>p.completePairs))].map(id=>({id,time:nominal(source,id)})).sort((a,b)=>a.time-b.time);
    const latest=pairs.at(-1), recent=pairs.slice(-4);
    const age=latest?(cycleAt-latest.time)/1000:null;
    if(age!==null&&age<0)throw new Error('Future nominal pair in probe');
    snapshots.push({cycle:i/4,source,atUtc:new Date(cycleAt).toISOString(),status:latest?'observed_complete_metadata':'no_complete_pair',
      latestPairId:latest?.id??null,latestNominalUtc:latest?new Date(latest.time).toISOString():null,latestNominalAgeSec:age,
      within12MinuteMetadataCutoff:age===null?null:age<=720,
      lastFourPairCount:recent.length,lastFourNominalSpanSec:recent.length===4?(recent.at(-1).time-recent[0].time)/1000:null});
  }
}
const sources=Object.fromEntries(['himawari9','gk2a'].map(source=>{
  const arrivals=probe.arrivals.filter(r=>r.source===source), rows=snapshots.filter(r=>r.source===source);
  const scored=rows.filter(r=>r.status==='observed_complete_metadata');
  return[source,{newlyCompletePairs:arrivals.length,medianArrivalDelayLowerSec:median(arrivals.map(r=>r.appearanceDelayLowerSec)),medianArrivalDelayUpperSec:median(arrivals.map(r=>r.appearanceDelayUpperSec)),
    cycleCount:rows.length,scoredMetadataSnapshots:scored.length,metadataSnapshotsWithin12Minutes:scored.filter(r=>r.within12MinuteMetadataCutoff).length,
    metadataAgeSec:scored.length?{min:Math.min(...scored.map(r=>r.latestNominalAgeSec)),median:median(scored.map(r=>r.latestNominalAgeSec)),max:Math.max(...scored.map(r=>r.latestNominalAgeSec))}:null}];
}));
const result={method:'seoul-bounded-listing-freshness-v1',inputSha256:createHash('sha256').update(raw).digest('hex'),startedAtUtc:probe.startedAtUtc,completedAtUtc:probe.completedAtUtc,
  freshnessRule:'Age of latest complete metadata pair at completion of all four requests in a probe cycle, using nominal slots and client clock; cutoff12minutes for comparison only.',
  limits:['No files were downloaded, decoded, quality-checked, inserted, or used to produce a cloud direction by this probe.',
    'Snapshot counts are not time-weighted availability, service-level estimates, or valid-signal uptime.',
    'The two sources have different nominal acquisition schedules; actual pixel times differ.',
    'First-listing complete pairs are excluded from arrival timing but included when describing the metadata visible at that time.',
    'Only this short twelve-minute interval is assessed; missing requests abstain rather than become zero-age records.'],sources,snapshots};
await fs.writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({sources,inputSha256:result.inputSha256},null,2));
