import fs from 'node:fs/promises';

// Offline audit of an exported seoul:getDayStationRows response. No requests,
// production writes, market orders, or claimed settlement adjudication.
const [input, output, awcInput] = process.argv.slice(2);
if (!input) throw new Error('Usage: node scripts/analyze-seoul-amos-metar.mjs <day.json> [output.json] [awc.json]');
const data = JSON.parse(await fs.readFile(input, 'utf8'));
const minute = 60_000;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const quantile = (values, fraction) => {
  const sorted = values.filter(finite).sort((a,b)=>a-b);
  if (!sorted.length) return null;
  const position = (sorted.length-1)*fraction, lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)]-sorted[lower])*(position-lower);
};
const stats = values => ({n:values.filter(finite).length, min:quantile(values,0),median:quantile(values,0.5),p90:quantile(values,0.9),max:quantile(values,1)});
const receipt = row => finite(row.firstSeenAt) ? row.firstSeenAt : row._creationTime;
const available = row => Math.max(receipt(row) ?? Infinity, row.updatedAt ?? -Infinity);
const localDate = time => new Date(time+9*60*minute).toISOString().slice(0,10);
const date = data.summary?.date ?? data.rows?.[0]?.date;
if(!/^\d{4}-\d{2}-\d{2}$/.test(date??''))throw new Error('A single explicit Seoul date is required.');
const sameDay = row => row.date===date && finite(row.obsTimeUtc) && localDate(row.obsTimeUtc)===date;
const normalizedRaw = value => String(value??'').trim().replace(/^METAR\s+/,'').replace(/\s+/g,' ');
const routine = row => row.reportType==='METAR' && /^(?:METAR\s+)?(?:COR\s+)?RKSI\s+\d{6}Z\b/.test(String(row.rawMetar??'').trim());
const unique = new Map();
for (const row of data.amosRows ?? []) {
  if (row.stationIcao !== 'RKSI' || row.rwyNo !== '2' || row.rwyDir !== '15L' || !finite(row.tempC) || !sameDay(row)) continue;
  const previous = unique.get(row.obsTimeUtc);
  if (!previous || (row.collectionCadence === 'one_minute' && previous.collectionCadence !== 'one_minute')) unique.set(row.obsTimeUtc,row);
}
const amos = [...unique.values()].sort((a,b)=>a.obsTimeUtc-b.obsTimeUtc);
const reportCandidates = (data.rows ?? []).filter(row=>row.stationIcao==='RKSI' && routine(row) && finite(row.tempC) && sameDay(row));
const reportCounts = new Map();
for(const row of reportCandidates)reportCounts.set(row.obsTimeUtc,(reportCounts.get(row.obsTimeUtc)??0)+1);
const reports = reportCandidates.filter(row=>reportCounts.get(row.obsTimeUtc)===1).sort((a,b)=>a.obsTimeUtc-b.obsTimeUtc);
const tenth = raw => {
  const match = /\bT([01])(\d{3})([01])(\d{3})\b/.exec(raw ?? '');
  return match ? Number(match[2])/10*(match[1]==='1'?-1:1) : null;
};
const rounded = value => Math.floor(value+0.5);
const matches = reports.map(row=>{
  const a=unique.get(row.obsTimeUtc);
  const precise=tenth(row.rawMetar);
  return {time:row.obsTimeLocal,obsTimeUtc:row.obsTimeUtc,metarC:row.tempC,tenthsRemarkC:precise,amosC:a?.tempC ?? null,
    roundedAmosC:a?rounded(a.tempC):null,matches:a?rounded(a.tempC)===rounded(precise ?? row.tempC):null,
    amosReceiptDelaySec:a&&finite(receipt(a))?(receipt(a)-a.obsTimeUtc)/1000:null,
    metarPersistenceDelaySec:finite(receipt(row))?(receipt(row)-row.obsTimeUtc)/1000:null};
});
const leadStudies = [0,1,2,5,10,15,20].map(leadMinutes=>{
  const rows=[];
  for(const report of reports){
    const decisionAt=report.obsTimeUtc-leadMinutes*minute;
    const sample=amos.filter(a=>a.obsTimeUtc<=decisionAt && finite(available(a)) && available(a)<=decisionAt && decisionAt-a.obsTimeUtc<=3*minute).at(-1);
    const prior=reports.filter(r=>r.obsTimeUtc<report.obsTimeUtc && finite(available(r)) && available(r)<=decisionAt).at(-1);
    if(!sample||!prior)continue;
    const actual=rounded(tenth(report.rawMetar)??report.tempC),prediction=rounded(sample.tempC),baseline=rounded(tenth(prior.rawMetar)??prior.tempC);
    rows.push({time:report.obsTimeLocal,decisionAt,amosTime:sample.obsTimeLocal,availableAt:available(sample),rawAmosC:sample.tempC,predictionC:prediction,actualC:actual,priorMetarC:baseline,errorC:prediction-actual,baselineErrorC:baseline-actual});
  }
  return {leadMinutes,n:rows.length,amosMatches:rows.filter(r=>r.errorC===0).length,priorMetarMatches:rows.filter(r=>r.baselineErrorC===0).length,
    amosMeanAbsoluteErrorC:rows.length?rows.reduce((s,r)=>s+Math.abs(r.errorC),0)/rows.length:null,
    priorMetarMeanAbsoluteErrorC:rows.length?rows.reduce((s,r)=>s+Math.abs(r.baselineErrorC),0)/rows.length:null,rows};
});
// A report-temperature match is not the same event as a new daily-high bucket.
// Keep a separate ledger of every retained target, including abstentions. The
// baseline is the maximum known by the decision, not the latest temperature.
const newHighStudies = [0,1,2,5,10,15,20].map(leadMinutes=>{
  const rows=reports.map(report=>{
    const decisionAt=report.obsTimeUtc-leadMinutes*minute;
    const recentAmos=amos.filter(a=>a.obsTimeUtc<=decisionAt && decisionAt-a.obsTimeUtc<=3*minute);
    const sample=recentAmos.filter(a=>finite(available(a)) && available(a)<=decisionAt).at(-1);
    const preceding=reports.filter(r=>r.obsTimeUtc<report.obsTimeUtc && r.obsTimeUtc<=decisionAt);
    const known=preceding.filter(r=>finite(available(r)) && available(r)<=decisionAt);
    // Excluding an overwritten prior report alone can make the historical
    // maximum too low. Abstain when the version then visible is unrecoverable.
    const overwrittenPrior=preceding.filter(r=>finite(receipt(r)) && receipt(r)<=decisionAt && finite(r.updatedAt) && r.updatedAt>decisionAt);
    const overwrittenAmos=recentAmos.filter(a=>finite(receipt(a)) && receipt(a)<=decisionAt && finite(a.updatedAt) && a.updatedAt>decisionAt && (!sample || a.obsTimeUtc>=sample.obsTimeUtc));
    const ambiguousPrior=reportCandidates.filter(r=>reportCounts.get(r.obsTimeUtc)>1 && r.obsTimeUtc<report.obsTimeUtc && r.obsTimeUtc<=decisionAt && finite(receipt(r)) && receipt(r)<=decisionAt);
    const maximum=known.length?Math.max(...known.map(r=>tenth(r.rawMetar)??r.tempC)):null;
    const confirmedMaximum=overwrittenPrior.length || ambiguousPrior.length ? null : maximum;
    const maximumRounded=confirmedMaximum===null?null:rounded(confirmedMaximum);
    const targetTemperature=tenth(report.rawMetar)??report.tempC;
    const reasons=[];
    if(!sample)reasons.push('no_recent_amos_available');
    if(!known.length)reasons.push('no_same_day_report_available');
    if(overwrittenPrior.length)reasons.push('unrecoverable_prior_report_version');
    if(overwrittenAmos.length)reasons.push('unrecoverable_latest_amos_version');
    if(ambiguousPrior.length)reasons.push('ambiguous_prior_report_timestamp');
    const scored=reasons.length===0;
    const actualNewHigh=maximumRounded===null?null:rounded(targetTemperature)>maximumRounded;
    const predictedNewHigh=scored?rounded(sample.tempC)>maximumRounded:null;
    const outcome=!scored?'abstained':predictedNewHigh?(actualNewHigh?'true_alert':'false_alert'):(actualNewHigh?'missed_new_high':'correct_no_new_high');
    return {time:report.obsTimeLocal,targetObsTimeUtc:report.obsTimeUtc,decisionAt,
      status:scored?'scored':'abstained',abstentionReasons:reasons,outcome,
      targetTemperatureC:targetTemperature,targetRoundedC:rounded(targetTemperature),
      confirmedAsOfMaximumC:confirmedMaximum,confirmedAsOfMaximumRoundedC:maximumRounded,
      knownReportCount:known.length,
      maximumReportDetails:confirmedMaximum===null?[]:known.filter(r=>(tenth(r.rawMetar)??r.tempC)===confirmedMaximum).map(r=>({time:r.obsTimeLocal,obsTimeUtc:r.obsTimeUtc,availableAt:available(r),temperatureC:tenth(r.rawMetar)??r.tempC})),
      uncertainPriorReportTimes:[...new Set([...overwrittenPrior,...ambiguousPrior].map(r=>r.obsTimeLocal))],
      sample:sample?{time:sample.obsTimeLocal,obsTimeUtc:sample.obsTimeUtc,receiptAt:receipt(sample),availableAt:available(sample),updatedAt:sample.updatedAt??null,collectionCadence:sample.collectionCadence??null,temperatureC:sample.tempC,roundedC:rounded(sample.tempC),ageAtDecisionSec:(decisionAt-sample.obsTimeUtc)/1000}:null,
      predictedNewHigh,actualNewHigh};
  });
  const abstentionReasons={};
  for(const row of rows)for(const reason of row.abstentionReasons)abstentionReasons[reason]=(abstentionReasons[reason]??0)+1;
  return {leadMinutes,retainedReportOpportunities:rows.length,scored:rows.filter(r=>r.status==='scored').length,
    abstentions:rows.filter(r=>r.status==='abstained').length,abstentionReasons,
    trueAlerts:rows.filter(r=>r.outcome==='true_alert').length,falseAlerts:rows.filter(r=>r.outcome==='false_alert').length,
    missedNewHighs:rows.filter(r=>r.outcome==='missed_new_high').length,correctNoNewHigh:rows.filter(r=>r.outcome==='correct_no_new_high').length,rows};
});
let sourceClockComparison;
if (awcInput) {
  const awc = JSON.parse(await fs.readFile(awcInput,'utf8'));
  const exclusions=[];
  const rows = reports.map(report=>{
    const matched=(awc.rows??[]).filter(row=>row.icaoId==='RKSI' && row.obsTime*1000===report.obsTimeUtc && row.metarType==='METAR');
    const a=unique.get(report.obsTimeUtc);
    // Ambiguous source revisions are retained as an exclusion rather than
    // picking whichever value produces the desired correspondence.
    if(matched.length!==1){exclusions.push({time:report.obsTimeLocal,reason:matched.length?'multiple_awc_records':'no_awc_record',count:matched.length});return null;}
    const row=matched[0], received=Date.parse(row.receiptTime);
    if(!finite(received)){exclusions.push({time:report.obsTimeLocal,reason:'invalid_awc_receipt'});return null;}
    if(normalizedRaw(row.rawOb)!==normalizedRaw(report.rawMetar)){exclusions.push({time:report.obsTimeLocal,reason:'raw_report_mismatch'});return null;}
    return {time:report.obsTimeLocal,awcTempC:row.temp,persistedTempC:report.tempC,
      awcReceiptDelaySec:(received-report.obsTimeUtc)/1000,
      localPersistenceAfterAwcReceiptSec:finite(receipt(report))?(receipt(report)-received)/1000:null,
      amosReceiptLeadToAwcSec:a&&finite(receipt(a))?(received-receipt(a))/1000:null,
      roundedAmosC:a?rounded(a.tempC):null,rawOb:row.rawOb};
  }).filter(Boolean);
  sourceClockComparison={awcInput,checkedAt:awc.checkedAt,joinedReports:rows.length,
    awcReceiptDelaySec:stats(rows.map(r=>r.awcReceiptDelaySec)),
    localPersistenceAfterAwcReceiptSec:stats(rows.map(r=>r.localPersistenceAfterAwcReceiptSec)),
    amosReceiptLeadToAwcSec:stats(rows.map(r=>r.amosReceiptLeadToAwcSec)),exclusions,rows};
}
const result={input,generatedAt:new Date().toISOString(),method:'Observed source persistence only; clock-filtered AMOS vs next routine METAR. No fitted model and no profitability claim.',
  limitations:['Small sample from one local day; not out-of-sample validation.','Database receipt clocks are insertion times, not first provider publication.','Database revisions can hide original report content; this is not an immutable point-in-time market backtest.','Current AMOS fields are not themselves a qualifying market settlement report.','No trades, spread, execution latency, fees, or quotes are evaluated.'],
  day:date,excludedReportRows:(data.rows??[]).length-reports.length,duplicateReportTimestamps:[...reportCounts].filter(([,count])=>count>1).length,
  amosRows:amos.length,oneMinuteRows:amos.filter(r=>r.collectionCadence==='one_minute').length,routineReports:reports.length,tenthsRemarks:matches.filter(r=>r.tenthsRemarkC!==null).length,
  reportTimeComparisons:{n:matches.filter(r=>r.amosC!==null).length,matches:matches.filter(r=>r.matches===true).length,rows:matches},
  amosMinuteReceiptDelaySec:stats(amos.filter(r=>r.collectionCadence==='one_minute').map(r=>finite(r.firstSeenAt)?(r.firstSeenAt-r.obsTimeUtc)/1000:null)),
  metarPersistenceDelaySec:stats(matches.map(r=>r.metarPersistenceDelaySec)),leadStudies,
  newHighMethod:'A rounded target-report temperature above the rounded same-day maximum known from retained routine reports at the decision. This is a target-report bucket event, not the final daily maximum. Opportunities are retained reports, not a predeclared complete schedule; missing reports are not measured.',newHighStudies,
  ...(sourceClockComparison?{sourceClockComparison}:{})};
if(output)await fs.writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,reportTimeComparisons:{...result.reportTimeComparisons,rows:undefined},leadStudies:leadStudies.map(({rows,...r})=>r),newHighStudies:newHighStudies.map(({rows,...r})=>r),sourceClockComparison:sourceClockComparison?{...sourceClockComparison,rows:undefined}:undefined},null,2));
