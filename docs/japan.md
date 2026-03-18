For **RJTT (Tokyo Haneda / Tokyo International Airport)**, the METAR is published on the Japan side by the **Japan Meteorological Agency (JMA)** through its aviation weather offices; Haneda’s local office is the **Tokyo Aviation Weather Service Center / Tokyo Aerodrome Meteorological Office**. JMA says its aviation weather offices make the aeronautical meteorological observations, and the Haneda office page is the local JMA office for Tokyo International Airport. ([Japan Meteorological Agency][1])

Operationally, think of it this way:

* **Originator / official meteorological authority:** **JMA**, specifically the Haneda aviation weather office for RJTT. ([Japan Meteorological Agency][1])
* **International/operational dissemination inside aviation networks:** JMA says observational reports and forecasts are exchanged through the **AFTN** and its aerodrome meteorological information network. ([Japan Meteorological Agency][1])
* **Commercial/contract real-time redistribution in Japan:** **JMBSC** is the JMA-designated organization that disseminates JMA data, including **METAR**, on a **real-time basis** via VPN/Internet/dedicated lines. ([jmbsc.or.jp][2])

For a source faster than **NOAA tgftp**, the best **public** option I found is the newer **AviationWeather Data API** rather than tgftp. AWC says the old Text Data Server was discontinued, the replacement is the **Data API**, and the site generally shows observations “within a minute or two” after receipt. Their current METAR cache files update **once a minute**. ([Aviation Weather Center][3])

Practical choices:

1. **Best public pull endpoint**

```text
https://aviationweather.gov/api/data/metar?ids=RJTT&format=raw
```

This is the direct AWC Data API replacement path for single-station latest METAR pulls. ([Aviation Weather Center][4])

2. **Best public bulk/fast-refresh file**

```text
https://aviationweather.gov/data/cache/metars.cache.xml.gz
https://aviationweather.gov/data/cache/metars.cache.csv.gz
```

These are official AWC cache files, updated **once a minute**, and are usually the better choice if you poll many stations or want predictable refresh cadence. ([Aviation Weather Center][4])

3. **Fastest official path overall, but not really “open public API”**
   Use **JMBSC real-time dissemination** or aviation telecom feeds like **AFTN/OPMET** access through the proper aviation channels. JMBSC explicitly says it disseminates JMA METAR data in real time, but this is a contract/service model rather than a simple anonymous REST endpoint. ([jmbsc.or.jp][2])

So the direct answer is: **JMA publishes Haneda’s METAR; the local publishing office is the Tokyo Aviation Weather Service Center at Haneda.** For something faster/better than **NOAA tgftp**, use **AviationWeather’s Data API** for public access, and **JMBSC real-time dissemination** if you need the lowest-latency Japan-side official feed. ([JMA Net][5])

---

## JMA Public Site Scraping Investigation (2026-03-18)

**Finding: JMA does NOT publish METAR text on any public-facing web page.** Their aviation pages are mostly static HTML with no JS-driven data loading for METAR/SPECI.

### What we checked

| Page | Result |
|------|--------|
| `jma-net.go.jp/haneda-airport/` | Static HTML, no JS bundles, no data endpoints. Links to TAF images and the airinfo portal. |
| `data.jma.go.jp/airinfo/index.html` | Portal page with links to fog, CCI, satellite products. No METAR endpoints. |
| `data.jma.go.jp/airinfo/data/awfo_taf.html?RJTT` | Static HTML with a commented-out jQuery line. TAF displayed as a **PNG image** (`QMCD98_RJTT.png`), not parseable text. |
| `data.jma.go.jp/omaad/aviation/jp/fog/` | Uses `jmatile.sw.bundle.js` — a Leaflet-based tile viewer for satellite fog products. Data root: `data.jma.go.jp/tile/satprod/`. No observation data. |
| `jma.go.jp/bosai/nowc/` | Nowcast tile viewer, same jmatile stack. Fetches `contents.json` for menu config. No METAR. |

### AMEDAS: closest thing to real-time obs

JMA’s **AMEDAS** (Automated Meteorological Data Acquisition System) is the only public JMA system with scrapeable real-time observation data:

* **Station table:** `https://www.jma.go.jp/bosai/amedas/const/amedastable.json`
  * Haneda = station **44166** ("羽田：東京国際空港")
* **Latest timestamp:** `https://www.jma.go.jp/bosai/amedas/data/latest_time.txt`
  * Returns ISO 8601: e.g. `"2026-03-19T04:50:00+09:00"`
* **Per-station data:** `https://www.jma.go.jp/bosai/amedas/data/point/44166/{YYYYMMDD}_{HH}.json`
  * e.g. `…/44166/20260319_00.json`
  * Updates every **10 minutes**
  * Fields: `temp`, `humidity`, `wind` (speed+direction), `precipitation` (10m/1h/3h/24h), `sun`, `snow`, gusts
* **All-station map snapshot:** `https://www.jma.go.jp/bosai/amedas/data/map/{YYYYMMDDHHmmss}.json`
  * Same 10-min cadence, but very large file (~truncated at 44166 in our test)

**AMEDAS limitations vs METAR:**
- No visibility, no cloud layers, no QNH/altimeter, no weather phenomena (RA/SN/FG etc.), no RVR
- No METAR-format text string
- 10-minute refresh (METAR is typically every 30 min with SPECI on change)

### Conclusion

**JMA does not expose METAR text on any public webpage or API.** Their aviation data (TAF, METAR) is distributed only through:
1. **AFTN/OPMET** (aviation telecom — not public)
2. **JMBSC** (contract service)
3. TAF rendered as **PNG images** (not parseable)

The AMEDAS JSON endpoints give real-time surface obs for Haneda (10-min refresh) but lack aviation-specific fields (vis, clouds, QNH, phenomena). **AWC Data API remains the fastest public source for actual METAR text.**


[1]: https://www.jma.go.jp/jma/en/Activities/aws.html "Japan Meteorological Agency | Weather Observation"
[2]: https://www.jmbsc.or.jp/en/meteo-data.html "JMBSC"
[3]: https://aviationweather.gov/help/upcoming/ "Upcoming changes"
[4]: https://aviationweather.gov/data/api/ "Data API"
[5]: https://www.jma-net.go.jp/haneda-airport/ "東京航空地方気象台 Tokyo Aviation Weather Service Center"
