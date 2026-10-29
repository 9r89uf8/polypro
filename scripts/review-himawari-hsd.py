"""Offline, sample-specific Himawari-9 HSD navigation/calibration review.

Usage:
  python scripts/review-himawari-hsd.py <B03.DAT.bz2> <B13.DAT.bz2> > review.json

Reads saved public HSD v1.3 files and writes JSON to stdout. It makes no network
requests, database writes, cloud classification, or temperature prediction.
Tested on four Japan-area B03/B13 pairs from 2026-10-29. Nonzero navigation
corrections and operation/degradation flags are rejected. Segmented files have
not been validated against real examples; the inspected files are all S0101.
Only updated positive B03 calibration and embedded B13 calibration are used.
Line times are brackets plus an explicitly interpolated estimate. The solar
geometry is an approximation and uses the Himawari projection longitude.
The surface grid has no cloud-height/parallax correction. No GK2A trend labels,
thresholds, or cross-satellite equivalence are asserted.

Reference: JMA HSD v1.3, header blocks 1-10 and the 2026-10-14 sensitivity
update notice. See docs/seoul-himawari-review-2026-10-29.md for evidence and
source links. Hsd(path).sample(latitude, longitude) is reusable offline.
"""
import bz2
import datetime as dt
import hashlib
import json
import math
from pathlib import Path
import statistics
import struct
import sys

UTC = dt.timezone.utc
MJD0 = dt.datetime(1858, 11, 17, tzinfo=UTC)
RKSI = (37.4602, 126.4407)

def iso(mjd):
    return (MJD0 + dt.timedelta(days=mjd)).isoformat()

def solar_geometry(time, latitude, longitude, satellite_longitude, rs_km, a_km, b_km):
    date = dt.datetime.fromisoformat(time)
    year_start = dt.datetime(date.year, 1, 1, tzinfo=UTC)
    next_year = dt.datetime(date.year+1, 1, 1, tzinfo=UTC)
    n = (date-year_start).days+1
    minutes = date.hour*60+date.minute+date.second/60+date.microsecond/60e6
    gamma = 2*math.pi/(next_year-year_start).days*(n-1+(minutes/60-12)/24)
    eq = 229.18*(0.000075+0.001868*math.cos(gamma)-0.032077*math.sin(gamma)-0.014615*math.cos(2*gamma)-0.040849*math.sin(2*gamma))
    decl = 0.006918-0.399912*math.cos(gamma)+0.070257*math.sin(gamma)-0.006758*math.cos(2*gamma)+0.000907*math.sin(2*gamma)-0.002697*math.cos(3*gamma)+0.00148*math.sin(3*gamma)
    hour_angle = math.radians(((minutes+eq+4*longitude)%1440)/4-180)
    lat, lon = math.radians(latitude), math.radians(longitude)
    sun = (-math.cos(decl)*math.sin(hour_angle), math.cos(lat)*math.sin(decl)-math.sin(lat)*math.cos(decl)*math.cos(hour_angle), math.sin(lat)*math.sin(decl)+math.cos(lat)*math.cos(decl)*math.cos(hour_angle))
    east = (-math.sin(lon),math.cos(lon),0)
    north = (-math.sin(lat)*math.cos(lon),-math.sin(lat)*math.sin(lon),math.cos(lat))
    up = (math.cos(lat)*math.cos(lon),math.cos(lat)*math.sin(lon),math.sin(lat))
    e2 = 1-(b_km/a_km)**2
    radius = a_km/math.sqrt(1-e2*math.sin(lat)**2)
    observer = (radius*math.cos(lat)*math.cos(lon),radius*math.cos(lat)*math.sin(lon),radius*(1-e2)*math.sin(lat))
    satlon = math.radians(satellite_longitude)
    vec = (rs_km*math.cos(satlon)-observer[0],rs_km*math.sin(satlon)-observer[1],-observer[2])
    norm = math.sqrt(sum(v*v for v in vec))
    view = [sum(x*y for x,y in zip(vec,basis))/norm for basis in (east,north,up)]
    dot = sum(x*y for x,y in zip((-sun[0],-sun[1],sun[2]),view))
    return {'cosZenith':sun[2], 'solarElevationDeg':math.degrees(math.asin(max(-1,min(1,sun[2])))), 'glintAngleDeg':math.degrees(math.acos(max(-1,min(1,dot))))}

class Hsd:
    def __init__(self, path):
        self.path = Path(path)
        compressed = self.path.read_bytes()
        self.sha256 = hashlib.sha256(compressed).hexdigest()
        self.buf = bz2.decompress(compressed)
        if self.buf[5] not in (0,1): raise ValueError('Invalid byte order')
        self.endian = '<' if self.buf[5] == 0 else '>'
        self.blocks = {}
        pos = 0
        for _ in range(self.read('H',3)):
            num = self.buf[pos]
            length = self.read('I' if num == 10 else 'H',pos+1)
            if num in self.blocks or not 1<=num<=11 or length<3: raise ValueError('Invalid header block')
            self.blocks[num] = (pos,length)
            pos += length
        self.data_offset = pos
        assert pos == self.read('I',70) and set(self.blocks)==set(range(1,12))
        assert self.buf[6:22].decode('ascii').strip('\x00 ') == 'Himawari-9'
        assert self.buf[82:114].decode('ascii').strip('\x00 ') == '1.3'
        assert self.buf[38:42].decode('ascii') in ('JP01','JP02','JP03','JP04')
        p = self.blocks[2][0]
        self.columns,self.lines = self.read('HH',p+5)
        assert self.read('H',p+3)==16 and self.read('B',p+9)==0
        assert len(self.buf)-pos == self.columns*self.lines*2 == self.read('I',74)
        p = self.blocks[3][0]
        self.lon0 = self.read('d',p+3)
        self.cfac,self.lfac = self.read('II',p+11)
        self.coff,self.loff = self.read('ff',p+19)
        self.rs,self.a,self.b = self.read('ddd',p+27)
        p = self.blocks[7][0]
        self.total_segments,self.segment,self.first_line = self.read('BBH',p+3)
        assert self.first_line>=1 and self.segment>=1 and self.segment<=self.total_segments
        p = self.blocks[8][0]
        self.rotation = self.read('d',p+11)
        nav_count = self.read('H',p+19)
        self.nav = [self.read('Hff',p+21+10*i) for i in range(nav_count)]
        # This bounded review accepts only the inspected zero-correction files.
        if self.rotation!=0 or any(c!=0 or l!=0 for _,c,l in self.nav): raise ValueError('Nonzero navigation correction requires separate review')
        self.quality = list(self.buf[78:82])
        if self.quality[0]!=0: raise ValueError('Nonzero operation/degradation flags')
        p = self.blocks[5][0]
        self.band = self.read('H',p+3)
        self.wave = self.read('d',p+5)
        self.bits,self.error,self.outside = self.read('HHH',p+13)
        self.gain,self.offset = self.read('dd',p+19)
        if self.band==3:
            self.albedo_coefficient,self.update,self.updated_gain,self.updated_offset = self.read('dddd',p+35)
            assert self.updated_gain>0 and self.update<=self.read('d',46) and self.updated_gain!=self.gain
        elif self.band==13:
            self.ir_c0,self.ir_c1,self.ir_c2,self.ir_C0,self.ir_C1,self.ir_C2,self.light,self.planck,self.boltz = self.read('ddddddddd',p+35)
        else: raise ValueError('Only B03/B13 reviewed')
        p = self.blocks[9][0]
        self.line_times = [self.read('Hd',p+5+10*i) for i in range(self.read('H',p+3))]
        p = self.blocks[10][0]
        self.line_errors = [self.read('HH',p+7+4*i) for i in range(self.read('H',p+5))]

    def read(self, fmt, pos):
        values=struct.unpack_from(self.endian+fmt,self.buf,pos)
        return values[0] if len(values)==1 else values

    def metadata(self):
        result={'file':self.path.name,'sha256':self.sha256,'satellite':self.buf[6:22].decode('ascii').strip('\x00 '), 'format':self.buf[82:114].decode('ascii').strip('\x00 '),'area':self.buf[38:42].decode('ascii'), 'band':self.band,'shape':[self.lines,self.columns], 'totalSegments':self.total_segments,'segmentSequence':self.segment,'firstLine':self.first_line,'navigationRotationMicroradians':self.rotation,'navigationEntries':self.nav, 'qualityFlags':self.quality,'lineErrorCount':len(self.line_errors), 'observationStartUtc':iso(self.read('d',46)), 'observationEndUtc':iso(self.read('d',54)), 'fileCreationUtc':iso(self.read('d',62)), 'projection':{'subLon':self.lon0,'cfac':self.cfac,'lfac':self.lfac,'coff':self.coff,'loff':self.loff,'rsKm':self.rs,'aKm':self.a,'bKm':self.b},'calibration':{'wavelengthMicrometers':self.wave,'validBits':self.bits,'errorCount':self.error,'outsideScanCount':self.outside,'originalGain':self.gain,'originalOffset':self.offset}}
        if self.band==3: result['calibration'].update({'albedoCoefficient':self.albedo_coefficient,'updatedAtUtc':iso(self.update),'updatedGain':self.updated_gain,'updatedOffset':self.updated_offset,'selected':'updated'})
        else: result['calibration'].update({'c0':self.ir_c0,'c1':self.ir_c1,'c2':self.ir_c2,'C0':self.ir_C0,'C1':self.ir_C1,'C2':self.ir_C2,'speedOfLight':self.light,'planckConstant':self.planck,'boltzmannConstant':self.boltz})
        return result

    def position(self,latitude,longitude):
        # Earth-centered Cartesian form, independent of the geocentric-latitude
        # expression in the first inspection parser.
        phi,dlon = math.radians(latitude),math.radians(longitude-self.lon0)
        e2 = 1-(self.b/self.a)**2
        n = self.a/math.sqrt(1-e2*math.sin(phi)**2)
        ex,ey,ez = n*math.cos(phi)*math.cos(dlon),n*math.cos(phi)*math.sin(dlon),n*(1-e2)*math.sin(phi)
        vx,vy,vz = self.rs-ex,ey,ez
        x = math.atan2(vy,vx)
        y = -math.atan2(vz,math.hypot(vx,vy))
        column1 = self.coff+math.degrees(x)*self.cfac/65536
        line1 = self.loff+math.degrees(y)*self.lfac/65536
        column = math.floor(column1+0.5)-1
        row = math.floor(line1+0.5)-self.first_line
        return row,column,line1,column1

    def center(self,row,column):
        global_line = row+self.first_line
        x = math.radians((column+1-self.coff)*65536/self.cfac)
        y = math.radians((global_line-self.loff)*65536/self.lfac)
        coefficient = math.cos(y)**2+(self.a/self.b)**2*math.sin(y)**2
        disc = (self.rs*math.cos(x)*math.cos(y))**2-coefficient*(self.rs**2-self.a**2)
        if disc<0: raise ValueError('Beyond Earth limb')
        sn = (self.rs*math.cos(x)*math.cos(y)-math.sqrt(disc))/coefficient
        sx,sy,sz = self.rs-sn*math.cos(x)*math.cos(y),sn*math.sin(x)*math.cos(y),-sn*math.sin(y)
        return math.degrees(math.atan2((self.a/self.b)**2*sz,math.hypot(sx,sy))),self.lon0+math.degrees(math.atan2(sy,sx))

    def count(self,row,column):
        if not 0<=row<self.lines or not 0<=column<self.columns: return None
        value = self.read('H',self.data_offset+2*(row*self.columns+column))
        if value in (self.error,self.outside) or not 0<=value<(1<<self.bits): return None
        return value

    def sample(self,latitude,longitude):
        row,col,line1,column1 = self.position(latitude,longitude)
        if not 0<=row<self.lines or not 0<=col<self.columns: return None
        center_lat,center_lon = self.center(row,col)
        distance = math.hypot((center_lat-latitude)*111.32,(center_lon-longitude)*111.32*math.cos(math.radians(latitude)))
        counts = [self.count(r,c) for r in range(row-1,row+2) for c in range(col-1,col+2)]
        good = [v for v in counts if v is not None]
        count = statistics.median(good) if self.band==3 and len(good)>=7 else self.count(row,col) if self.band==13 else None
        if count is None: return None
        global_line=row+self.first_line
        below=max(((l,t) for l,t in self.line_times if l<=global_line),default=None)
        above=min(((l,t) for l,t in self.line_times if l>=global_line),default=None)
        if below is None or above is None: raise ValueError('Missing line timing bracket')
        fraction=0 if below[0]==above[0] else (global_line-below[0])/(above[0]-below[0])
        interpolated=below[1]+fraction*(above[1]-below[1])
        sample={'latitude':latitude,'longitude':longitude,'row':row,'column':col,'lineOneBased':line1,'columnOneBased':column1,'centerLatitude':center_lat,'centerLongitude':center_lon,'nearestCenterDistanceKm':distance,'nearestCount':self.count(row,col),'validNeighborhoodCount':len(good),'calibrationCount':count,'lineTimeBracketUtc':[iso(below[1]),iso(above[1])],'interpolatedLineTimeUtc':iso(interpolated)}
        if self.band==3:
            original=count*self.gain+self.offset
            radiance=count*self.updated_gain+self.updated_offset
            albedo=radiance*self.albedo_coefficient
            solar=solar_geometry(iso(interpolated),latitude,longitude,self.lon0,self.rs,self.a,self.b)
            if solar['solarElevationDeg']<20 or solar['glintAngleDeg']<25: raise ValueError('Low illumination or glint')
            sample.update({'radianceWm2SrUm':radiance,'originalRadianceWm2SrUm':original,'albedoFraction':albedo,'originalAlbedoFraction':original*self.albedo_coefficient,'solarNormalizedReflectance':albedo/solar['cosZenith'],'solar':solar})
        else:
            radiance=count*self.gain+self.offset
            if radiance<=0: raise ValueError('Nonpositive IR radiance')
            wave_m=self.wave*1e-6
            radiance_per_m=radiance*1e6
            effective=self.planck*self.light/(self.boltz*wave_m)/math.log1p(2*self.planck*self.light*self.light/(wave_m**5*radiance_per_m))
            bt=self.ir_c0+self.ir_c1*effective+self.ir_c2*effective**2
            te_back=self.ir_C0+self.ir_C1*bt+self.ir_C2*bt**2
            radiance_back=2*self.planck*self.light*self.light/(wave_m**5*math.expm1(self.planck*self.light/(self.boltz*wave_m*te_back)))/1e6
            sample.update({'radianceWm2SrUm':radiance,'effectiveBrightnessTemperatureK':effective,'brightnessTempK':bt,'radianceRoundtripRelativeError':abs(radiance_back-radiance)/radiance})
        return sample

def review(path):
    reader=Hsd(path)
    samples=[]
    for index in range(25):
        lat=RKSI[0]+(4-(index//5)*2)/111.32
        lon=RKSI[1]+((index%5)*2-4)/(111.32*math.cos(math.radians(RKSI[0])))
        sample=reader.sample(lat,lon)
        if sample is not None: samples.append({'id':index,**sample})
    return {**reader.metadata(),'center':reader.sample(*RKSI),'validCellCount':len(samples),'cells':samples}

if __name__=='__main__':
    if len(sys.argv)<2:
        raise SystemExit('Usage: python scripts/review-himawari-hsd.py <B03.DAT.bz2> <B13.DAT.bz2> ... > review.json')
    outputs=[review(path) for path in sys.argv[1:]]
    print(json.dumps(outputs,indent=2))
