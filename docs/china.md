For **ZSPD (Shanghai Pudong / PVG)**, the **publisher of the METAR is the airport meteorological station/office at Shanghai Pudong**, not NOAA. Under CAAC rules, **airport meteorological stations issue the airport weather reports (METAR/SPECI)**, then send them via **AFTN or other approved means** to the regional and national civil-aviation meteorological centers for redistribution. CAAC’s rules also list **Shanghai Pudong** as one of the airports designated to publish **routine reports every 30 minutes**, and as part of the Chinese OPMET bulletin sets used for international exchange. ([Civil Aviation Administration of China][1])

So the chain is essentially:

**Pudong airport met office/station → CAAC East China regional met center / CAAC national met center → international OPMET distribution → downstream mirrors like NOAA**

That means NOAA tgftp is a **redistribution endpoint**, not the origin. CAAC’s regulations explicitly say airport stations issue METAR/SPECI, regional centers collect them, and the **civil aviation meteorological center** compiles and forwards the OPMET bulletins internationally. ([Civil Aviation Administration of China][1])

For a **faster public source than NOAA tgftp**, the best choice is usually the newer **AviationWeather Data API**, not the legacy tgftp tree. AviationWeather says the product-specific `/api/data/metar` endpoint replaces the old CGI/tgftp-era workflows, and its cache files are updated **once a minute**. ([Aviation Weather Center][2])

Use these:

```text
Latest METAR for one station:
https://aviationweather.gov/api/data/metar?ids=ZSPD&format=json

All current METARs cache (updated once a minute):
https://aviationweather.gov/data/cache/metars.cache.xml.gz
https://aviationweather.gov/data/cache/metars.cache.csv.gz
```

If you want the **closest operational stream to the international source**, use **WIFS** or **SADIS API** rather than NOAA tgftp. Both distribute ICAO/WMO aviation data, including **OPMET** such as METAR/TAF; WIFS exposes OPMET collections and requires an API key / approved access, while SADIS provides an OPMET API on the UK side. These are better fits for production systems that need timely regulated aviation feeds. ([Aviation Weather Center][3])

Practical ranking for “latest ZSPD METAR”:

1. **Direct CAAC/AMHS/AFTN feed** — fastest/authoritative, but usually not publicly accessible. ([Civil Aviation Administration of China][1])
2. **WIFS / SADIS OPMET API** — best non-legacy operational distribution. ([Aviation Weather Center][3])
3. **AviationWeather `/api/data/metar`** — best public HTTP endpoint. ([Aviation Weather Center][2])
4. **NOAA tgftp** — legacy mirror, generally not the one I’d build against now. ([Aviation Weather Center][2])


[1]: https://www.caac.gov.cn/XXGK/XXGK/GFXWJ/201511/P020151103346926804323.pdf "关于发布《民用航空飞行气象情报发布与交换办法》"
[2]: https://aviationweather.gov/data/api/ "Data API"
[3]: https://aviationweather.gov/wifs/?utm_source=chatgpt.com "WAFS Internet File Service (WIFS)"

---

## Chinese Public Site Scraping Investigation (2026-03-18)

**Finding: No Chinese public website exposes METAR text or a scrapeable aviation observation API.**

### What we checked

| Site | URL | Result |
|------|-----|--------|
| **CMA weather portal** | `weather.cma.cn` | Public API at `/api/weather/view?stationid=58370` (Pudong). Returns temp, humidity, pressure, wind, 7-day forecast. **No visibility, clouds, or METAR.** Updates ~hourly. |
| **CMA data platform** | `data.cma.cn` | Lists "Global 9h/24h Airport Weather Forecast" products (`M.0001.0029.S001`, `M.0001.0030.S001`) sourced from GTS. **Registration required** (real-name or institutional). Data gateway API returned auth errors. |
| **CMA surface obs** | `data.cma.cn` dataCode `A.0012.0001` | Ground station obs (temp, pressure, humidity, wind, precip). Not aviation-specific, requires registration, 2-day lag. |
| **CAAC main site** | `caac.gov.cn` | Just a mobile redirect page. No weather data exposed. |
| **CAAC data center** | `adcc.caac.gov.cn` | DNS not found — not publicly accessible. |
| **VariFlight** | `variflight.com/weather/ZSPD` | 502 error. Chinese domestic aviation data aggregator, likely geo-restricted or requires auth. |
| **Airportal** | `airportal.cn` | 403 Forbidden from outside China. |
| **MHA** | `mha.cc` | Timeout. Chinese domestic site, likely inaccessible from outside China. |
| **Feeyo** | `feeyo.com/weather/airport/ZSPD.html` | Timeout. Another Chinese domestic aviation site. |
| **FlightAware** | `flightaware.com` | 402 (paywall). |
| **FlightRadar24** | `flightradar24.com` | 403 Forbidden. |

### CMA Public API (closest thing available)

```text
Station lookup:  https://weather.cma.cn/api/autocomplete?q=pudong  → station 58370
Current obs:     https://weather.cma.cn/api/weather/view?stationid=58370
```

Returns JSON with:
- `now.temperature`, `now.humidity`, `now.pressure`, `now.windDirection`, `now.windSpeed`, `now.precipitation`
- 7-day forecast
- `lastUpdate` timestamp

**Missing vs METAR:** No visibility, no cloud layers, no QNH/altimeter, no weather phenomena, no METAR text string.

### Key differences from Japan

- Japan's JMA at least exposes **AMEDAS** with 10-min surface obs (including Haneda as station 44166) via public JSON endpoints
- China's CMA public API is coarser — general forecast-grade data, not raw station obs at aviation resolution
- China's aviation weather infrastructure (CAAC met centers) appears to be **entirely behind authentication walls**, with domestic aviation weather sites (VariFlight, Airportal, Feeyo) also inaccessible from outside China
- The `data.cma.cn` platform has aviation products (airport forecasts from GTS) but requires **real-name registration** to access

### Conclusion

**No public Chinese endpoint beats AWC for ZSPD METAR.** The CAAC/AFTN chain is closed, CMA's public API lacks aviation fields, and domestic Chinese aviation weather sites are geo-restricted or auth-gated. AWC Data API (~1 min refresh) remains the fastest publicly accessible source for ZSPD METAR text from outside China.
