For **RKSI / Incheon Intl**, the **official publisher** is the **Aviation Meteorological Office (AMO) of the Korea Meteorological Administration (KMA)**. Korea’s eAIP says AMO/KMA is the authority responsible for civil-aviation meteorological services, and specifically lists **RKSI** with **half-hourly routine observations** and **METAR** service. ([aim.koca.go.kr][1])

For a public official page, AMO’s own airport weather page for **RKSI** is here and shows the current aerodrome weather/METAR feed for Incheon. ([KMA][2])

On “faster than NOAA tgftp”:

1. **Best NOAA replacement:**
   Use the modern **AviationWeather.gov Data API** instead of `tgftp`. NOAA/NWS says the redeveloped API serves **worldwide METAR**, and its cache files are updated **once a minute**. Example pattern:
   `https://aviationweather.gov/api/data/metar?ids=RKSI&format=json`
   Their docs also recommend cache files for routine access, with current METAR cache updated once a minute. ([Aviation Weather Center][3])

2. **Closest-to-source / likely fastest for RKSI specifically:**
   Use **KMA/AMO directly**, not NOAA. Korea’s AMO publishes METAR/SPECI for domestic airports, and AMO’s developer guide exposes a dedicated endpoint for raw METAR by ICAO:
   `http://amoapi.kma.go.kr/amoApi/metar?icao=RKSI`
   The same guide says it returns valid **METAR/SPECI** text for the requested domestic airport ICAO. ([KMA][4])

3. **If you need runway-level data sooner than plain METAR:**
   AMO also publishes **MET REPORT** for RKSI on its aviation weather site, which can include runway-specific wind/visibility details and may be operationally more granular than waiting for the next routine METAR. ([항공날씨][5])

My practical ranking for “latest RKSI METAR, faster than tgftp” is:

* **AMO/KMA direct** (`amoapi.kma.go.kr`) for Korea-only, source-adjacent access. ([KMA][4])
* **aviationweather.gov API** for a cleaner, supported NOAA endpoint replacing old tgftp workflows. ([Aviation Weather Center][3])
* **AMO web pages / MET REPORT** when you want the freshest operational display rather than a generic global mirror. ([항공날씨][6])

One caveat: I found the **AMO API endpoint in the official developer guide**, but I did not verify live response behavior from this environment, so treat the exact endpoint as documented/official but untested here. ([KMA][4])


[1]: https://aim.koca.go.kr/eaipPub/Package/2025-03-06/html/eAIP/KR-GEN-3.5-en-GB.html "




      METEOROLOGICAL SERVICES




\<!--page title-->"
[2]: https://amo.kma.go.kr/eng/airport.do?icaoCode=RKSI&utm_source=chatgpt.com "INCHEON Int'l Airport Aerodrome Weather"
[3]: https://aviationweather.gov/data/api/ "Data API"
[4]: https://amo.kma.go.kr/apidata/amo_api_developer_guide1.pdf?utm_source=chatgpt.com "항공기상정보 공공데이터 개발(OPEN API) 개발자 가이드 1. ..."
[5]: https://global.amo.go.kr/control/metar-metreport-dep2.do%3Bjsessionid%3D313219DF4AC53568405676BB4BE78DA1.exptomcat31?stnCd=RKSI&utm_source=chatgpt.com "met report - 항공날씨"
[6]: https://global.amo.go.kr/control/metar-metreport-dep1.do "항공날씨"
