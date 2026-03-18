For **LEMD / Adolfo Suárez Madrid-Barajas**, the official METAR publisher in Spain is **AEMET (Agencia Estatal de Meteorología)**, Spain’s **aeronautical meteorological authority**. AEMET’s AMA service is the official aeronautical weather portal, and it explicitly says it provides METAR/SPECI/TAF data in AEMET’s database for aerodromes, including Spanish aerodromes. ([ama.aemet.es][1])

For the **fastest source other than NOAA tgftp**, the best public choice is usually the **AviationWeather Data API** rather than the old tgftp file tree. Their current API is the supported machine-to-machine interface, and their current-METAR cache updates **once a minute**. Example station query pattern: `https://aviationweather.gov/api/data/metar?ids=LEMD&format=json`. They also publish full current-METAR cache files updated once a minute. ([Aviation Weather Center][2])

A few practical options, fastest to most “official operational”:

1. **AEMET / AMA** — most authoritative for Spain, but access is oriented to registered aeronautical users rather than a simple open public JSON endpoint. ([ama.aemet.es][1])
2. **AviationWeather API** — easiest modern HTTPS endpoint for programmatic pulls; better choice than tgftp for freshness and supportability. ([Aviation Weather Center][2])
3. **WIFS / OPMET feeds** — good for operational bulk distribution, but it requires an account and is organized as 5-minute windows/collections, so it is usually not the simplest “latest single-station METAR” endpoint. ([Aviation Weather Center][3])

So, in one line:

* **Official publisher for Madrid-Barajas METAR:** **AEMET**
* **Faster public endpoint than NOAA tgftp:** **AviationWeather Data API** (`/api/data/metar?...`)
* **If you need earliest operational distribution rather than easiest HTTP API:** **WIFS/OPMET or AEMET operational channels**, not tgftp. ([ama.aemet.es][1])

A good default for polling LEMD is:

```text
https://aviationweather.gov/api/data/metar?ids=LEMD&format=json
```

And if you want bulk current METARs:

```text
https://aviationweather.gov/data/cache/metars.cache.xml.gz
https://aviationweather.gov/data/cache/metars.cache.csv.gz
```

Both are documented as updating once a minute. ([Aviation Weather Center][2])

## Verified AMA Findings

On **March 18, 2026**, the AMA side was verified beyond the public brochure
pages:

- AMA has a working account flow:
  - home: `https://ama.aemet.es/`
  - login: `https://ama.aemet.es/acceso`
  - create account: `https://ama.aemet.es/acceso?_com_liferay_login_web_portlet_LoginPortlet_mvcRenderCommandName=%2Flogin%2Fcreate_account&p_p_id=com_liferay_login_web_portlet_LoginPortlet&p_p_lifecycle=0&p_p_mode=view&p_p_state=maximized&saveLastPath=false`
- After login, the official Madrid-side page is:
  - `https://ama.aemet.es/metar-taf`
- That page is not just a static map. It is an authenticated `busquedasbasicas`
  search app with:
  - an autocomplete JSON lookup:
    - `POST /metar-taf?p_p_id=busquedasbasicas&p_p_lifecycle=2&p_p_state=normal&p_p_mode=view&p_p_cacheability=cacheLevelPage`
    - payload example: `_busquedasbasicas_q=LEM`
  - a search-submit action:
    - `..._busquedasbasicas_javax.portlet.action=realizarBusqueda...`
    - returns the lower result panel with raw `METAR`, `TAF`, and aerodrome
      warning content

Verified `LEMD` behavior:

- The autocomplete returned:
  - `LEMD, Aeropuerto Adolfo Suárez Madrid-Barajas`
- The authenticated result page rendered:
  - latest `METAR`
  - latest active `TAF`
  - aerodrome-warning section when present
- Example `LEMD` result captured during the check:
  - `LEMD 182130Z VRB02KT CAVOK 09/02 Q1009 NOSIG`

## Practical Conclusion

**Spain is better than Japan or China for an official-source race.**

- AMA is not an open public JSON API.
- But it is an authenticated, working, web-facing source for `LEMD` latest
  `METAR/TAF`.
- That makes **AEMET AMA vs NOAA** a realistic publish-race setup for Madrid,
  using an authenticated session on the AMA side.

## Notes

- AMA access is intended for registered **aeronautical users**. The public FAQ
  and account flow indicate that registration is controlled rather than fully
  open anonymous access. ([ama.aemet.es][4])
- For a simple unauthenticated fallback, the **AviationWeather Data API**
  remains the easiest public endpoint.

---

## Automated AMA Scraping — Verified Working (2026-03-18)

An authenticated curl session successfully logged in and fetched the latest
`LEMD` `METAR` and active `TAF` from AMA.

### Login flow (curl)

```bash
LOGIN_PAGE='https://ama.aemet.es/acceso?p_p_id=com_liferay_login_web_portlet_LoginPortlet&p_p_lifecycle=0&p_p_state=maximized&p_p_mode=view&saveLastPath=false&_com_liferay_login_web_portlet_LoginPortlet_mvcRenderCommandName=%2Flogin%2Flogin'

# 1. Get the actual AMA login form
curl -s -c cookies.txt "$LOGIN_PAGE" > login_page.html

# 2. Extract the real form action and hidden formDate
ACTION_URL=$(sed -n 's#.*<form action="\([^"]*\)".*id="_com_liferay_login_web_portlet_LoginPortlet_loginForm".*#\1#p' login_page.html | sed 's/&amp;/\&/g')
FORM_DATE=$(sed -n 's#.*id="_com_liferay_login_web_portlet_LoginPortlet_formDate"[^>]*value="\([^"]*\)".*#\1#p' login_page.html)

# 3. POST credentials to the extracted action URL
curl -s -L -b cookies.txt -c cookies.txt \
  --data-urlencode "_com_liferay_login_web_portlet_LoginPortlet_login=$AEMET_USERNAME" \
  --data-urlencode "_com_liferay_login_web_portlet_LoginPortlet_password=$AEMET_PASSWORD" \
  --data-urlencode "_com_liferay_login_web_portlet_LoginPortlet_formDate=$FORM_DATE" \
  --data-urlencode "_com_liferay_login_web_portlet_LoginPortlet_saveLastPath=false" \
  --data-urlencode "_com_liferay_login_web_portlet_LoginPortlet_redirect=" \
  --data-urlencode "_com_liferay_login_web_portlet_LoginPortlet_doActionAfterLogin=false" \
  --data-urlencode "_com_liferay_login_web_portlet_LoginPortlet_checkboxNames=rememberMe" \
  "$ACTION_URL" > after_login.html
```

### `LEMD` METAR fetch (authenticated)

```bash
# 4. Load the authenticated METAR/TAF page
curl -s -b cookies.txt "https://ama.aemet.es/metar-taf" > metar_page.html

# 5. Extract the search action and page-specific formDate
SEARCH_URL=$(sed -n 's#.*<form action="\([^"]*\)".*id="_busquedasbasicas_fm".*#\1#p' metar_page.html | sed 's/&amp;/\&/g')
FORM_DATE=$(sed -n 's#.*id="_busquedasbasicas_formDate"[^>]*value="\([^"]*\)".*#\1#p' metar_page.html)

# 6. Submit an authenticated search for LEMD
curl -s -L -b cookies.txt -c cookies.txt \
  --data-urlencode "_busquedasbasicas_formDate=$FORM_DATE" \
  --data-urlencode "_busquedasbasicas_coaci_aeropuertos=LEMD" \
  --data-urlencode "_busquedasbasicas_nombre_consulta=Metar / Speci" \
  --data-urlencode "_busquedasbasicas_desc_consulta=Busqueda Metar / Speci" \
  --data-urlencode "_busquedasbasicas_checkboxNames=check-peninsula,check-canarias" \
  "$SEARCH_URL" > metar_result.html

# 7. Parse the raw METAR from the result block
grep -oE 'data-report="LEMD [^"]*"' metar_result.html | sed 's/data-report="//;s/"$//'
```

### Verified `LEMD` result

The authenticated result block rendered:

- `METAR`: `LEMD 182130Z VRB02KT CAVOK 09/02 Q1009 NOSIG`
- `TAF`: the latest active `LEMD` TAF in the same lower panel

### Autocomplete endpoint (verified)

```bash
curl -s -b cookies.txt \
  "https://ama.aemet.es/metar-taf?p_p_id=busquedasbasicas&p_p_lifecycle=2&p_p_state=normal&p_p_mode=view&p_p_cacheability=cacheLevelPage" \
  -d "_busquedasbasicas_q=LEM"
```

This returned JSON suggestions including:

- `LEMD, Aeropuerto Adolfo Suárez Madrid-Barajas`

### Key technical details

- **Platform:** AMA uses a Liferay-based authenticated web app.
- **Main page:** `https://ama.aemet.es/metar-taf`
- **Search app:** authenticated `busquedasbasicas` form flow
- **Autocomplete:** JSON over `p_p_lifecycle=2`
- **Result rendering:** the `realizarBusqueda` submit returns HTML containing
  the lower result panel, including raw `METAR` and `TAF`
- **METAR location in HTML:** `data-report="LEMD ..."` on the result block
- **Token handling:** the `p_auth` token differed between the login page and
  the authenticated `metar-taf` page, so the safest approach is to extract the
  current form action from the page you are about to submit
- **Session nuance:** AMA sets important auth cookies on the redirect chain
  after the login POST, so non-browser clients need to capture `Set-Cookie`
  headers on intermediate `302` responses, not just the final followed page
- **Client-side behavior:** the page also embeds an AJAX refresh URL for the
  current `LEMD` search, so there is both a form-submit path and a client-side
  re-query path inside the rendered page

### Conclusion

Spain/AMA is a **realistic publish-race candidate** because:

1. AMA is accessible with an authenticated account
2. the `LEMD` METAR/TAF page is fetchable with a deterministic session flow
3. the latest `METAR` is present in a parseable HTML attribute on the results
   page

## Repo Note

The repo now has a Madrid implementation built around this flow:

- `/madrid/today`
- `/madrid/day/[date]`
- `convex/madrid.js`

What was **not** verified here:

- that AMA consistently beats AWC/NOAA in live publication time
- any separate AMA JSON API beyond the authenticated autocomplete lookup
- the AEMET OpenData station-observation API as part of this AMA session


[1]: https://ama.aemet.es/en/que-es-el-ama "What is A. M. A. - AMA"
[2]: https://aviationweather.gov/data/api/ "Data API"
[3]: https://aviationweather.gov/help/?utm_source=chatgpt.com "AWC Help"
[4]: https://ama.aemet.es/faqs "AMA FAQs"
