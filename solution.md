That raw report **really is 46°F at ~2:25am Chicago time** — and the reason Wunderground doesn’t show it is very likely **because that particular “METAR” is not part of the normal hourly METAR/SPECI feed that WU ingests**.

### 1) Decode your raw METAR (what it’s saying)

`KORD 200825Z AUTO ... 08/06 ... RMK T00800060 MADISHF`

* `200825Z` = **Feb 20 @ 08:25 UTC** → **02:25 AM CST** (Chicago is UTC‑6 in February)
* `08/06` = temp/dewpoint **8°C / 6°C**

    * 8°C = **46.4°F** → displayed as **46°F** if rounded
* `RMK T00800060` = **8.0°C / 6.0°C** in tenths (more precise), which confirms the same temp/dewpoint
* `MADISHF` = the *important clue* (more below)

So your code that found a max of **46°F at 2:25am** from that line is doing the correct math.

---

### 2) The smoking gun: `MADISHF` means “high-frequency / generated” data (not the usual METAR feed)

The string **`MADISHF`** is not a standard “weather” remark you’d normally see in the official dissemination. It is a **tag inserted by the Iowa Environmental Mesonet (IEM)** when they **generate “fake” METAR strings** from NOAA MADIS high‑frequency airport sensor data.

From IEM’s own “High Frequency METAR Obs” note:

* IEM started ingesting a **High Frequency METAR** product and **creating generated (“fake”) METARs**
* Those generated METARs **contain the string `MADISHF` in the remarks section** “to hint where it came from” ([Iowa Environmental Mesonet][1])

So your 08:25Z report is almost certainly **one of those generated HF records**, not an “official” routine hourly METAR or a normal SPECI in the same way WU typically stores.

---

### 3) Why Wunderground shows 44°F at 2:00 and 2:51 but not the 46°F at 2:25

There are two very common reasons:

#### Reason A (most likely): WU doesn’t ingest these HF “MADISHF” generated records

WU/Weather.com generally builds its observation history from a feed of **routine METAR + (sometimes) SPECI**.
If the 2:25 record you’re using is an **IEM-added high-frequency observation**, WU simply won’t have it to display.

That matches your exact case because the METAR contains `MADISHF`. ([Iowa Environmental Mesonet][1])

#### Reason B (also possible): WU is downsampling to “hourly-ish” observations

At many US airports, routine METARs are disseminated around **H+50 to H+55** each hour. ([National Weather Service][2])
So seeing a reading at **2:51am** fits a normal routine METAR time.

WU often shows one observation per hour (or near-hour), so it can skip an “in-between” report at 2:25 even if it existed.

---

### 4) Does this mean you should ignore some METAR data?

For **apples-to-apples comparison with Wunderground daily max**: **Yes — you need to match WU’s likely input set.**

In practice, that means:

#### ✅ If your goal is “match WU as closely as possible”

Use **routine + special** METARs, but **exclude high-frequency generated observations**.

With IEM, you can do this cleanly by *not requesting* HF reports:

* `report_type=3,4` (Routine + Specials)
* **NOT** `report_type=1` (HFMETAR)

IEM documents report types exactly like this:
`1 (HFMETAR), 3 (Routine), 4 (Specials)` ([Iowa Environmental Mesonet][3])

Also, as a safety net, you can exclude any raw METAR containing the substring `MADISHF`.

#### ✅ If your goal is “true highest temperature the airport sensors saw”

Then include the high-frequency feed, but you must expect disagreement vs WU.

Also note: IEM themselves warn that the MADIS HF temp values have had precision/unit quirks and can make computed extremes differ by ~1 degree at times. ([Iowa Environmental Mesonet][1])
And NOAA MADIS notes that what used to be called HF‑METAR is essentially **1‑minute ASOS data** and shouldn’t be treated as standard METAR observations. ([madis.ncep.noaa.gov][4])

So: **don’t mix HF into a “WU comparison” metric** unless you explicitly want to show “sensor max” vs “WU max”.

---

## Recommended implementation rule (simple + PRO)

Implement **two daily max calculations** and store both:

1. **`metarMax_official`**

* Source: IEM `report_type=3,4` only
* (Routine + SPECI)
* This is the best candidate to match WU.

2. **`metarMax_all`**

* Source: IEM `report_type=1,3,4`
* BUT tag any report that includes `MADISHF` as `isHighFrequency=true`
* This gives you “true sensor-ish max” and helps explain differences.

Then in your UI:

* Show **Manual(WU)** vs **METAR Official Max**
* Optional toggle/column: **HF Max** (with a warning badge “HF/MADIS”)

That way, when someone asks “why doesn’t WU show 46?”, your app can literally show:

* “46°F came from HF feed (MADISHF), WU doesn’t include it.”

---

## Direct answer to your specific question

> “Is it because by 2:51am the temperature had dropped to 44F?”

It *could* have dropped, but the more important point is:

* The **46°F report you used is flagged `MADISHF`**, which indicates it’s a **high‑frequency generated record** from IEM’s augmentation ([Iowa Environmental Mesonet][1])
* WU likely **doesn’t ingest that dataset** (and/or shows only routine hourly points)

So **you shouldn’t count `MADISHF`/HFMETAR reports if the goal is to match WU**. Use `report_type=3,4` for comparison. ([Iowa Environmental Mesonet][3])

---

[1]: https://mesonet.agron.iastate.edu/onsite/news.phtml?id=1290 "IEM :: High Frequency METAR Obs"
[2]: https://www.weather.gov/media/surface/WSOH8.pdf?utm_source=chatgpt.com "AVIATION WEATHER OBSERVATIONS for Supplementary ..."
[3]: https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?help=&utm_source=chatgpt.com "Documentation on /cgi-bin/request/asos.py"
[4]: https://madis.ncep.noaa.gov/madis_OMO.shtml?utm_source=chatgpt.com "1-minute ASOS Data"
