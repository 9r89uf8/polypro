"""Bounded local benchmark of one previously verified public Himawari pair.

Usage:
  python scripts/benchmark-himawari-rksi.py --download-once WORK_DIR OUTPUT.json
  python scripts/benchmark-himawari-rksi.py --use-existing WORK_DIR OUTPUT.json

Downloads at most one B03 and one B13 object for 2026-10-29 0230 JP03. Existing
files prevent another download. URLs, expected sizes, and SHA-256 hashes come
from the retained four-pair evidence. No retries, redirects, credentials,
production writes, or source activation. Decode-only mode verifies the same
hashes. Memory/timing describe this local machine, not the Convex runtime.
"""
import concurrent.futures
import ctypes
import datetime as dt
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import platform
import re
import runpy
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import redirect_stdout

ROOT = Path(__file__).resolve().parent.parent
EVIDENCE = ROOT / 'docs/assets/seoul-himawari-four-pair-evidence-20261029.json'
STRICT_READER = ROOT / 'scripts/review-himawari-hsd.py'
INSPECT_READER = ROOT / 'scripts/inspect-himawari-rksi.py'

def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='milliseconds')

def memory():
    if os.name != 'nt':
        return {'available':False,'reason':'Windows process working-set counters are unavailable on this platform.'}
    class Counters(ctypes.Structure):
        _fields_ = [('cb',ctypes.c_ulong),('PageFaultCount',ctypes.c_ulong),
            ('PeakWorkingSetSize',ctypes.c_size_t),('WorkingSetSize',ctypes.c_size_t),
            ('QuotaPeakPagedPoolUsage',ctypes.c_size_t),('QuotaPagedPoolUsage',ctypes.c_size_t),
            ('QuotaPeakNonPagedPoolUsage',ctypes.c_size_t),('QuotaNonPagedPoolUsage',ctypes.c_size_t),
            ('PagefileUsage',ctypes.c_size_t),('PeakPagefileUsage',ctypes.c_size_t),('PrivateUsage',ctypes.c_size_t)]
    kernel = ctypes.WinDLL('kernel32',use_last_error=True)
    psapi = ctypes.WinDLL('psapi',use_last_error=True)
    kernel.GetCurrentProcess.restype = ctypes.c_void_p
    psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p,ctypes.POINTER(Counters),ctypes.c_ulong]
    psapi.GetProcessMemoryInfo.restype = ctypes.c_int
    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    if not psapi.GetProcessMemoryInfo(kernel.GetCurrentProcess(),ctypes.byref(counters),counters.cb):
        return {'available':False,'reason':str(ctypes.get_last_error())}
    return {'available':True,'workingSetBytes':counters.WorkingSetSize,
        'peakWorkingSetBytes':counters.PeakWorkingSetSize,'privateBytes':counters.PrivateUsage,
        'peakPagefileBytes':counters.PeakPagefileUsage,
        'method':'Windows GetProcessMemoryInfo; peak includes interpreter and all allocations in this fresh child process.'}

def child(kind, filename):
    before = memory()
    started, wall0, cpu0 = utc(),time.perf_counter_ns(),time.process_time_ns()
    if kind == 'strict':
        spec = importlib.util.spec_from_file_location('benchmark_hsd_reader',STRICT_READER)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        result = module.review(filename)
        summary = {'satellite':result['satellite'],'format':result['format'],'band':result['band'],
            'shape':result['shape'],'validCellCount':result['validCellCount'],'sha256':result['sha256'],
            'pixelArrayBytes':result['shape'][0]*result['shape'][1]*2,
            'centerCount':result['center']['nearestCount'],
            'centerCalibrationCount':result['center']['calibrationCount'],
            'centerBrightnessTempK':result['center'].get('brightnessTempK'),
            'centerSolarNormalizedReflectance':result['center'].get('solarNormalizedReflectance')}
    elif kind == 'inspect':
        sys.argv = [str(INSPECT_READER),filename]
        capture = io.StringIO()
        with redirect_stdout(capture):
            runpy.run_path(str(INSPECT_READER),run_name='__main__')
        result = json.loads(capture.getvalue())
        summary = {'band':result['band'],'shape':[result['lines'],result['columns']],
            'centerCount':result['rksi']['count'],'centerValid':result['rksi']['validCount'],
            'pixelArrayBytes':result['lines']*result['columns']*2}
    else:
        raise ValueError('Unknown reader mode')
    cpu_seconds=(time.process_time_ns()-cpu0)/1e9
    wall_seconds=(time.perf_counter_ns()-wall0)/1e9
    print(json.dumps({'reader':kind,'startedAtUtc':started,'completedAtUtc':utc(),
        'wallSeconds':wall_seconds,'processCpuSeconds':cpu_seconds,
        'memoryBefore':before,'memoryAfter':memory(),'result':summary}))

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        raise urllib.error.HTTPError(args[0].full_url,args[2],'Redirects are disabled',args[4],None)

def download(band, record, destination):
    if destination.exists() or destination.with_suffix(destination.suffix+'.partial').exists():
        raise RuntimeError('Benchmark destination already exists; use --use-existing instead of downloading again.')
    parsed=urllib.parse.urlparse(record['sourceUrl'])
    expected_resolution='R05' if band=='B03' else 'R20'
    expected_path=f'/AHI-L1b-Japan/2026/10/29/0230/HS_H09_20261029_0230_{band}_JP03_{expected_resolution}_S0101.DAT.bz2'
    if parsed.scheme!='https' or parsed.netloc!='noaa-himawari9.s3.amazonaws.com' or parsed.path!=expected_path or parsed.query or parsed.fragment:
        raise ValueError('Only the verified public JP03 source object is allowed.')
    started, start = utc(),time.perf_counter_ns()
    req=urllib.request.Request(record['sourceUrl'],headers={'User-Agent':'polypro-offline-hsd-benchmark/1.0','Accept-Encoding':'identity'})
    opener=urllib.request.build_opener(NoRedirect)
    partial=destination.with_suffix(destination.suffix+'.partial')
    digest=hashlib.sha256()
    total=0
    with opener.open(req,timeout=20) as response:
        header_at,header_elapsed=utc(),(time.perf_counter_ns()-start)/1e9
        headers=dict(response.headers.items())
        if response.status!=200: raise ValueError('Unexpected HTTP status')
        length=response.headers.get('Content-Length')
        if length is not None and int(length)!=record['sizeBytes']: raise ValueError('Changed source object size')
        with partial.open('xb') as handle:
            while True:
                if (time.perf_counter_ns()-start)/1e9>40: raise TimeoutError('Total download exceeded 40 seconds')
                chunk=response.read(1024*1024)
                if not chunk: break
                total+=len(chunk)
                if total>record['sizeBytes']: raise ValueError('Response exceeded verified object size')
                digest.update(chunk)
                handle.write(chunk)
    ended,elapsed=utc(),(time.perf_counter_ns()-start)/1e9
    if total!=record['sizeBytes'] or digest.hexdigest()!=record['sha256']:
        raise ValueError('Downloaded object failed size/SHA256 verification')
    partial.rename(destination)
    return {'band':band,'url':record['sourceUrl'],'requestStartedAtUtc':started,'headersReceivedAtUtc':header_at,
        'completedAtUtc':ended,'headerWaitSeconds':header_elapsed,'totalWallSeconds':elapsed,
        'bytes':total,'sha256':digest.hexdigest(),'sha256MatchesVerifiedSample':True,'httpStatus':200,
        'responseHeaders':headers,'file':str(destination.relative_to(ROOT)),
        'averageBodyAndRequestMbitPerSecond':total*8/elapsed/1e6}

def verify_existing(band,record,destination):
    raw=destination.read_bytes()
    digest=hashlib.sha256(raw).hexdigest()
    if len(raw)!=record['sizeBytes'] or digest!=record['sha256']: raise ValueError('Existing file differs from verified source')
    return {'band':band,'url':record['sourceUrl'],'mode':'existing verified file; no network timing measured',
        'bytes':len(raw),'sha256':digest,'sha256MatchesVerifiedSample':True,'file':str(destination.relative_to(ROOT))}

def run_decoder(kind,filename):
    parent_started,start=utc(),time.perf_counter_ns()
    result=subprocess.run([sys.executable,str(Path(__file__).resolve()),'--child',kind,str(filename)],
        check=True,capture_output=True,text=True,timeout=60)
    parsed=json.loads(result.stdout)
    parsed['freshChildTotalWallSeconds']=(time.perf_counter_ns()-start)/1e9
    parsed['parentStartedAtUtc']=parent_started
    parsed['parentCompletedAtUtc']=utc()
    return parsed

def main(mode,work_arg,output_arg):
    if mode not in ('--download-once','--use-existing'): raise ValueError('Choose --download-once or --use-existing')
    work=Path(work_arg).resolve()
    output=Path(output_arg).resolve()
    if not work.is_relative_to(ROOT) or not output.is_relative_to(ROOT): raise ValueError('Benchmark paths must stay in this repository')
    if output.exists(): raise ValueError('Refusing to overwrite existing benchmark evidence')
    evidence_bytes=EVIDENCE.read_bytes()
    sources=json.loads(evidence_bytes)
    pair=next(frame for frame in sources['frames'] if frame['timelineUtc']=='2026-10-29T02:30:00Z' and frame['observationNumber']=='JP03')
    work.mkdir(parents=True,exist_ok=True)
    files={band:work/f'himawari9-{band.lower()}-jp03-202610290230.DAT.bz2' for band in ('B03','B13')}
    if mode=='--download-once' and any(file.exists() or file.with_suffix(file.suffix+'.partial').exists() for file in files.values()):
        raise ValueError('A destination file already exists; no repeat request is permitted')
    started,start=utc(),time.perf_counter_ns()
    result={'startedAtUtc':started,'mode':mode,
        'scope':'One archived, hash-verified public pair on local Windows. No arrival/publication latency, Convex latency, SLA, cloud forecast, or production feasibility assertion.',
        'environment':{'platform':platform.platform(),'machine':platform.machine(),'python':sys.version.split()[0],'logicalCpuCount':os.cpu_count()},
        'sourceEvidenceSha256':hashlib.sha256(evidence_bytes).hexdigest(),
        'readerSha256':{'strict':hashlib.sha256(STRICT_READER.read_bytes()).hexdigest(),'inspect':hashlib.sha256(INSPECT_READER.read_bytes()).hexdigest()},
        'schedule':'Two concurrent streaming downloads to disk; fresh-process strict decodes sequentially B03 then B13. Independent footprint inspections occur afterward and are excluded from pair download-to-strict-result timing.',
        'downloads':[],'strictDecodes':[],'independentInspections':[]}
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            operation=download if mode=='--download-once' else verify_existing
            tasks={band:executor.submit(operation,band,pair['channels'][band],files[band]) for band in files}
            result['downloads']=[tasks[band].result() for band in files]
        result['pairDownloadCompletedAtUtc']=utc()
        result['pairDownloadWallSeconds']=(time.perf_counter_ns()-start)/1e9
        for band in files:
            decoded=run_decoder('strict',files[band])
            if decoded['result']['sha256']!=pair['channels'][band]['sha256'] or decoded['result']['validCellCount']!=25:
                raise ValueError('Strict decoder did not reproduce the verified pair')
            result['strictDecodes'].append({'band':band,**decoded})
        result['strictPairResultCompletedAtUtc']=utc()
        result['downloadToStrictPairResultWallSeconds']=(time.perf_counter_ns()-start)/1e9
        for band in files:
            inspected=run_decoder('inspect',files[band])
            strict=next(row for row in result['strictDecodes'] if row['band']==band)
            if inspected['result']['centerCount']!=strict['result']['centerCount'] or inspected['result']['shape']!=strict['result']['shape']:
                raise ValueError('Independent inspection disagrees with strict decode')
            result['independentInspections'].append({'band':band,**inspected})
        result['successful']=True
    except Exception as error:
        result['successful']=False
        result['error']=f'{type(error).__name__}: {error}'
        raise
    finally:
        result['completedAtUtc']=utc()
        result['wholeBenchmarkWallSeconds']=(time.perf_counter_ns()-start)/1e9
        output.parent.mkdir(parents=True,exist_ok=True)
        output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'successful':True,'output':str(output.relative_to(ROOT)),
        'pairDownloadWallSeconds':result['pairDownloadWallSeconds'],
        'downloadToStrictPairResultWallSeconds':result['downloadToStrictPairResultWallSeconds'],
        'strictDecodes':[{key:row[key] for key in ('band','wallSeconds','processCpuSeconds','freshChildTotalWallSeconds','memoryAfter','result')} for row in result['strictDecodes']]},indent=2))

if __name__=='__main__':
    if len(sys.argv)==4 and sys.argv[1]=='--child': child(sys.argv[2],sys.argv[3])
    elif len(sys.argv)==4: main(*sys.argv[1:])
    else: raise SystemExit(__doc__)
