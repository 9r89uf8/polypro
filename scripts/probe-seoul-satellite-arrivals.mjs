import fs from 'node:fs/promises';
import path from 'node:path';

// Bounded public NOAA listing research only. No production changes, credentials,
// object downloads, forecasts, or market requests. Keep first-listing pairs
// separate from pairs observed appearing during the probe.
const [output, minutesArg = '12', secondsArg = '30'] = process.argv.slice(2);
const minutes = Number(minutesArg), intervalSeconds = Number(secondsArg);
if (!output || !Number.isFinite(minutes) || minutes < 1 || minutes > 30 ||
    !Number.isFinite(intervalSeconds) || intervalSeconds < 20 || intervalSeconds > 120) {
  throw new Error('Usage: node scripts/probe-seoul-satellite-arrivals.mjs OUTPUT.json [1-30 minutes] [20-120 seconds]');
}
const startedAt = Date.now(), deadline = startedAt + minutes * 60_000;
const iso = value => new Date(value).toISOString();
const tag = (xml, name) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml)?.[1];
const sources = [
  {name:'himawari9', bucket:'noaa-himawari9', prefix:hour => `AHI-L1b-Japan/${iso(hour).slice(0,13).replaceAll('-','/').replace('T','/')}`,
    parse:key => {
      const m = /HS_H09_(\d{8})_(\d{4})_(B03|B13)_JP(0[1-4])_R(05|20)_S0101\.DAT\.bz2$/.exec(key);
      if (!m) return null;
      if (m[5] !== (m[3]==='B03'?'05':'20')) throw new Error('Unexpected Himawari channel resolution');
      const base = Date.parse(`${m[1].slice(0,4)}-${m[1].slice(4,6)}-${m[1].slice(6,8)}T${m[2].slice(0,2)}:${m[2].slice(2)}:00Z`);
      return {pairId:`${m[1]}${m[2]}-JP${m[4]}`,band:m[3]==='B03'?'visible':'infrared',nominalAt:base+(Number(m[4])-1)*150_000};
    }},
  {name:'gk2a', bucket:'noaa-gk2a-pds', prefix:hour => `AMI/L1B/LA/${iso(hour).slice(0,7).replace('-','')}/${iso(hour).slice(8,10)}/${iso(hour).slice(11,13)}/`,
    parse:key => {
      const m = /gk2a_ami_le1b_(vi006|ir105)_la(005|020)ge_(\d{12})\.nc$/.exec(key);
      if (!m) return null;
      if (m[2] !== (m[1]==='vi006'?'005':'020')) throw new Error('Unexpected GK2A channel resolution');
      const t=m[3];
      return {pairId:t,band:m[1]==='vi006'?'visible':'infrared',nominalAt:Date.parse(`${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}T${t.slice(8,10)}:${t.slice(10,12)}:00Z`)};
    }},
];
const state = new Map(), everComplete = new Set();
const evidence = {
  method:'Public S3 listing observations at a bounded polling interval; no object decode or end-to-end usable signal measurement.',
  startedAtUtc:iso(startedAt), requestedMinutes:minutes, intervalSeconds,
  caveats:['Pairs already complete in the first successful listing of their prefix are left-censored and excluded from appearance delays.',
    'The lower bound is the start of the preceding successful complete listing; the upper bound is completion of the first listing containing both bands.',
    'Nominal slots are not pixel acquisition times. Local and HTTP clocks are retained separately. A listing observation is not a decoded usable signal.',
    'This bounded sample is not a delivery SLA. Missing or incomplete pairs remain explicit.'],
  polls:[], arrivals:[], leftCensoredPairs:[], reappearances:[], objects:{},
};
await fs.mkdir(path.dirname(path.resolve(output)),{recursive:true});
async function persist(){await fs.writeFile(output,JSON.stringify({...evidence,updatedAtUtc:iso(Date.now())},null,2)+'\n');}
async function listing(source,hour){
  const prefix=source.prefix(hour), key=`${source.name}:${prefix}`, prior=state.get(key);
  const url=`https://${source.bucket}.s3.amazonaws.com/?list-type=2&prefix=${encodeURIComponent(prefix)}&max-keys=1000`;
  const requestStartedAt=Date.now();
  try {
    const response=await fetch(url,{signal:AbortSignal.timeout(15_000)});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const xml=await response.text(), completedAt=Date.now();
    if(xml.length>2_000_000 || tag(xml,'IsTruncated')!=='false')throw new Error('Incomplete or oversized listing; no inferred absence');
    const objects=[...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(m=>({key:tag(m[1],'Key'),lastModifiedUtc:tag(m[1],'LastModified'),bytes:Number(tag(m[1],'Size'))}));
    const pairs=new Map();
    for(const object of objects){
      const parsed=source.parse(object.key??'');
      if(!parsed)continue;
      const pair=pairs.get(parsed.pairId)??{pairId:parsed.pairId,nominalAt:parsed.nominalAt};
      if(pair[parsed.band])throw new Error('Ambiguous duplicate channel');
      pair[parsed.band]=object;pairs.set(parsed.pairId,pair);
      const objectId=`${source.name}:${object.key}`;
      if(!evidence.objects[objectId])evidence.objects[objectId]={...object,firstListingStartedUtc:iso(requestStartedAt),firstSeenUtc:iso(completedAt),initialListing:!prior};
    }
    const complete=[...pairs.values()].filter(p=>p.visible&&p.infrared);
    for(const pair of complete){
      if(prior?.complete.has(pair.pairId))continue;
      const identity=`${source.name}:${pair.pairId}`;
      if(everComplete.has(identity)){
        evidence.reappearances.push({source:source.name,pairId:pair.pairId,observedAtUtc:iso(completedAt)});
        continue;
      }
      everComplete.add(identity);
      const record={source:source.name,pairId:pair.pairId,nominalSlotUtc:iso(pair.nominalAt),firstSeenUtc:iso(completedAt),
        previousAbsentListingStartedUtc:prior?iso(prior.requestStartedAt):null,
        firstContainingListingStartedUtc:iso(requestStartedAt),httpDate:response.headers.get('date'),
        appearanceDelayLowerSec:prior?(prior.requestStartedAt-pair.nominalAt)/1000:null,
        appearanceDelayUpperSec:(completedAt-pair.nominalAt)/1000,
        objectModificationDelaySec:(Math.max(Date.parse(pair.visible.lastModifiedUtc),Date.parse(pair.infrared.lastModifiedUtc))-pair.nominalAt)/1000,
        visible:pair.visible,infrared:pair.infrared};
      (prior?evidence.arrivals:evidence.leftCensoredPairs).push(record);
    }
    evidence.polls.push({source:source.name,prefix,url,requestStartedUtc:iso(requestStartedAt),completedUtc:iso(completedAt),
      httpDate:response.headers.get('date'),durationMs:completedAt-requestStartedAt,objectCount:objects.length,
      completePairs:complete.map(p=>p.pairId),partialPairs:[...pairs.values()].filter(p=>!p.visible||!p.infrared).map(p=>({pairId:p.pairId,visible:!!p.visible,infrared:!!p.infrared}))});
    state.set(key,{requestStartedAt,complete:new Set(complete.map(p=>p.pairId))});
  } catch(error){evidence.polls.push({source:source.name,prefix,url,requestStartedUtc:iso(requestStartedAt),completedUtc:iso(Date.now()),error:String(error.message??error)});}
}
for(let cycle=0;;cycle++){
  const now=Date.now(), hour=Math.floor(now/3_600_000)*3_600_000;
  await Promise.all(sources.flatMap(source=>[hour-3_600_000,hour].map(h=>listing(source,h))));
  await persist();
  console.log(JSON.stringify({cycle,at:iso(Date.now()),arrivals:evidence.arrivals.length,errors:evidence.polls.filter(p=>p.error).length}));
  if(Date.now()>=deadline)break;
  await new Promise(resolve=>setTimeout(resolve,Math.min(intervalSeconds*1000,deadline-Date.now())));
}
evidence.completedAtUtc=iso(Date.now());
await persist();
