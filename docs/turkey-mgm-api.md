# Turkey MGM API (Meteoroloji Genel Müdürlüğü)

Discovered March 22, 2026. The Turkish State Meteorological Service operates
an undocumented but fully functional REST API at `servis.mgm.gov.tr/web/`.
No API key or authentication is needed — only `Origin` and `Referer` headers.

## Authentication

No token or key required. Every request must include:

```
Origin: https://www.mgm.gov.tr
Referer: https://www.mgm.gov.tr/
Accept: application/json
```

Without these headers the API returns 403. The same headers are used by the
official MGM website and mobile app.

## Base URL

```
https://servis.mgm.gov.tr/web/
```

## Station / Location IDs

MGM uses several identifier types:

| ID Type | Example | Used For |
|---|---|---|
| `istNo` (station number) | `17128` | Esenboğa Airport — observations, station metadata |
| `merkezId` (center ID) | `90601` | Ankara city center — daily forecast |
| `saatlikTahminIstNo` | `17130` | Ankara — 3-hourly forecast |
| `ilPlaka` (province plate) | `6` | Ankara province — bulk queries |

To find IDs for other locations, query `/web/merkezler/iller` (all provinces)
or `/web/merkezler/ililcesi?il=Ankara` (districts within a province).

### Key IDs for Ankara / Esenboğa

- Airport observations: `istno=17128` (Ankara Esenboğa Airport, LTAC)
- City observations: `istno=17130` (Ankara central)
- 3-hourly forecast: `istno=17130` (airport station 17128 returns empty for forecasts)
- 5-day daily forecast: `merkezid=90601`
- Province bulk queries: `ilPlaka=6`

## Endpoints

### Current Conditions

```
GET /web/sondurumlar?istno=17128
```

Returns the latest observation for a station. Airport stations include the raw METAR.

Response (single-element array):
```json
{
  "istNo": 17128,
  "veriZamani": "2026-03-22T23:30:00.000Z",
  "sicaklik": 4.5,
  "hissedilenSicaklik": 4.5,
  "nem": 94,
  "ruzgarHiz": 4.32,
  "ruzgarYon": 270,
  "aktuelBasinc": 900,
  "denizeIndirgenmisBasinc": 1008.2,
  "gorus": 10000,
  "kapalilik": 7,
  "hadiseKodu": "CB",
  "rasatMetar": "LTAC 222350Z VRB01KT 9999 SCT040 BKN100 05/04 Q1008 NOSIG ...",
  "rasatSinoptik": "-9999",
  "rasatTaf": "-9999",
  "yagis00Now": 0,
  "yagis1Saat": 0,
  "yagis6Saat": 0,
  "yagis12Saat": 0,
  "yagis24Saat": 0,
  "yagis10Dk": -9999,
  "karYukseklik": -9999,
  "denizSicaklik": -9999,
  "denizVeriZamani": "2026-03-22T06:00:00.000Z"
}
```

Key fields:
- `sicaklik` — temperature in °C (0.1° precision from AWS, not METAR integer)
- `hissedilenSicaklik` — feels-like temperature °C
- `nem` — relative humidity %
- `ruzgarHiz` — wind speed in m/s
- `ruzgarYon` — wind direction in degrees
- `gorus` — visibility in meters
- `denizeIndirgenmisBasinc` — sea-level pressure in hPa
- `aktuelBasinc` — station pressure in hPa
- `kapalilik` — cloud cover (oktas, 0–8)
- `hadiseKodu` — weather code (see weather codes below)
- `rasatMetar` — raw METAR string (airport stations only)
- `veriZamani` — observation timestamp (UTC)
- `-9999` means "not available"

Other query forms:
- `?il=Ankara` — returns current conditions for the province capital
- `?merkezid=90601` — by center ID

### All Current Conditions for a Province

```
GET /web/sondurumlar/ilTumSondurum?ilPlaka=6
```

Returns current observations for every station in the province.

### 3-Hourly Forecast

```
GET /web/tahminler/saatlik?istno=17130
```

Returns 8 forecast time steps at 3-hour intervals (~24 hours ahead).
Only works for city center stations, not airport stations.

Response:
```json
{
  "baslangicZamani": "2026-03-22T12:00:00.000Z",
  "istNo": 17130,
  "merkez": "ANKARA",
  "tahmin": [
    {
      "tarih": "2026-03-23T00:00:00.000Z",
      "hadise": "CB",
      "sicaklik": 6,
      "hissedilenSicaklik": 6,
      "nem": 96,
      "ruzgarYonu": 59,
      "ruzgarHizi": 2,
      "maksimumRuzgarHizi": 6
    }
  ]
}
```

Forecast fields:
- `tarih` — forecast valid time (UTC)
- `sicaklik` — temperature °C (whole degrees)
- `hissedilenSicaklik` — feels-like °C
- `nem` — humidity %
- `ruzgarYonu` — wind direction degrees
- `ruzgarHizi` — wind speed (units unclear, likely m/s or km/h)
- `maksimumRuzgarHizi` — max gust speed
- `hadise` — weather code

Other query forms:
- `?merkezid=90601`
- `?il=Ankara`

### 5-Day Daily Forecast

```
GET /web/tahminler/gunluk?merkezid=90601
```

Returns min/max temperatures and weather for 5 days.

Response fields per day (numbered 1–5):
- `enDusukGun1` through `enDusukGun5` — daily minimum °C
- `enYuksekGun1` through `enYuksekGun5` — daily maximum °C
- `hadiseGun1` through `hadiseGun5` — weather code
- `ruzgarHizGun1` through `ruzgarHizGun5` — wind speed
- `ruzgarYonGun1` through `ruzgarYonGun5` — wind direction
- `nemGun1` through `nemGun5` — humidity ranges

Other query forms:
- `?istno=90601`
- `?il=Ankara`

### Station Metadata

```
GET /web/istasyonlar                     # All 1,930 stations
GET /web/istasyonlar?istno=17128         # Single station
GET /web/istasyonlar/il?plaka=6          # All stations in a province
```

### Location Lookup

```
GET /web/merkezler/iller                 # All 81 provinces
GET /web/merkezler/ililcesi?il=Ankara    # All districts in a province
GET /web/merkezler?il=Ankara             # Single province center
GET /web/merkezler?merkezid=90601        # By center ID
GET /web/merkezler?sorgu=Ankara          # Search by name
```

## Weather Codes

Used in `hadiseKodu` (observations) and `hadise` (forecasts):

| Code | Meaning | Icon |
|---|---|---|
| `A` | Clear (Açık) | `A.svg` |
| `AB` | Partly clear | `AB.svg` |
| `PB` | Partly cloudy (Parçalı bulutlu) | `PB.svg` |
| `CB` | Cloudy (Çok bulutlu) | `CB.svg` |
| `HY` | Light rain (Hafif yağmur) | `HY.svg` |
| `Y` | Rain (Yağmur) | `Y.svg` |
| `SY` | Shower (Sağanak yağış) | `SY.svg` |
| `HSY` | Light shower (Hafif sağanak) | `HSY.svg` |
| `KY` | Snow (Kar yağışı) | `KY.svg` |
| `KKY` | Sleet (Karla karışık yağmur) | `KKY.svg` |
| `GSY` | Thunderstorm (Gök gürültülü sağanak) | `GSY.svg` |
| `S` | Fog (Sis) | `S.svg` |
| `PUS` | Haze (Puslu) | `PUS.svg` |

Icons available at `https://www.mgm.gov.tr/Images_Sys/hadiseler/{CODE}.svg`

## Daily XML Bulletin

A public XML file with daily forecasts for all provinces (no headers needed):

```
GET https://www.mgm.gov.tr/FTPDATA/analiz/sonSOA.xml
```

Contains region-grouped city forecasts with max/min temps and Turkish-language
weather descriptions. Updated once or twice daily.

## Rate Limits

No documented rate limits. The API is used by the official website and mobile
app which make frequent requests. Polling every 10 minutes for observations
should be safe. Avoid excessive burst requests to prevent IP-based blocking.

## Publish Race Results (March 23, 2026)

Tested with METAR `LTAC 230020Z` (observation taken at 00:20Z):

| Source | First seen | Latency from obs |
|---|---|---|
| **MGM sondurumlar** | **00:22Z** | **~2 minutes** |
| NOAA tgftp | 00:25Z | ~5 minutes |
| AviationWeather.gov | 00:26Z | ~6 minutes |

MGM is the fastest source for LTAC METARs, beating NOAA by ~3 minutes.
AviationWeather.gov is a downstream of NOAA, about 1 minute slower.

## `sondurumlar` Update Frequency

The `veriZamani` field updates roughly every **10 minutes** with AWS data
at 0.1°C precision. This is a live AWS feed, not just METAR repackaging:

```
00:00Z  veriZamani=00:00  temp=3.9°C  (METAR still shows 23:50Z / 05°C)
00:06Z  veriZamani=00:06  temp=3.8°C  (temp changed 0.1°C between METARs)
00:20Z  veriZamani=00:20  temp=3.6°C  (synced with new METAR)
00:30Z  veriZamani=00:30  temp=3.6°C  (next 10-min AWS update)
```

The METAR in `rasatMetar` updates on the METAR cycle (:20/:50), but
`veriZamani` and `sicaklik` update every ~10 minutes independently.
Temperature values between METARs have sub-degree changes (3.9 → 3.8 → 3.6)
that the METAR's integer rounding (05°C) doesn't capture.

MGM also includes the **full METAR with RMK runway winds** — NOAA strips
those remarks.

## Known Limitations

- Hourly (3-hourly) forecast only available for city center stations, not
  airport stations. For Ankara, use `istno=17130` instead of `17128`.
- Forecast temperatures are whole degrees only.
- The API is undocumented and could change without notice.
- `-9999` is the sentinel value for unavailable/missing data.
- `denizSicaklik` (sea temperature) and `karYukseklik` (snow depth) are
  typically `-9999` for inland stations.
- The `sondurumlar` update frequency needs verification — it may update
  every 10–30 minutes with AWS data, or only with each METAR cycle.

## Convex Environment Variables

No environment variables needed — the API is open. The required Origin/Referer
headers are set in the fetch function.

## Useful Links

- MGM website: https://www.mgm.gov.tr
- MGM Ankara forecast page: https://www.mgm.gov.tr/tahmin/il-ve-ilceler.aspx?m=ANKARA
- Hezarfen aviation portal: https://hezarfen.mgm.gov.tr
- Observation viewer: https://rasat.mgm.gov.tr
- Turkish AIP MET section: https://www.dhmi.gov.tr/AIPDocuments/LT_GEN_3_5_en.pdf
