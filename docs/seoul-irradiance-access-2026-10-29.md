# AMATERASS and JAXA P-Tree: public-document check, October 29, 2026 KST

The current AMATERASS developer site still advertises two-and-a-half-minute
surface-irradiance products, but **its corporate/commercial use continues to
require advance contact**. JAXA P-Tree's February 2026 commercial-use change
applies to specified products distributed through P-Tree; it does not grant
rights to the separate AMATERASS/Chiba archive. P-Tree's linked terms also
require advance commercial-use notification.

## AMATERASS product and operation claims

The [developer's product guide](https://amaterass.science/products-guide/)
identifies `dwn.sw.flx.sfc` as estimated downward shortwave flux at the surface
(direct plus diffuse global irradiance), in W/m². The `jp01.1km` through
`jp04.1km` products represent four successive scans at offsets 0, 2.5, 5,
and 7.5 minutes from one nominal ten-minute timestamp. They share the Japan
grid with the ten-minute `msm.1km` product: 2521 rows × 3001 columns, roughly
120–150°E and 22.4–47.6°N. These nominal bounds include RKSI, but do not prove
a currently valid irradiance retrieval there. The guide supplies separate
latitude, longitude, and per-pixel observation-time files, including matching
`grd.time.mjd.hms.jp01.1km`–`jp04.1km` files. Actual pixel time must not be
replaced by the filename timestamp.

The [current overview](https://amaterass.science/overview/) describes ongoing
Himawari-8/9 processing every ten minutes over the full disk and every 2.5
minutes over Japan, and advertises availability approximately ten minutes
after satellite observation. This is a general provider statement, not a
measured RKSI receipt delay, distribution SLA, or guarantee specifically
established for each jp01–jp04 file. The [developer homepage](https://amaterass.science/)
likewise describes continuous operation and carries an October 25, 2026
update date.

## AMATERASS rights and the former consortium

The [download page, updated October 25, 2026](https://amaterass.science/product-download/),
explicitly separates educational/research access from corporate/commercial
use. Educational and research use is free; corporate/commercial use requires
contact in advance. It identifies Hideaki Takenaka as the system's developer
and operator and `amaterass.cr.chiba-u.ac.jp` as an educational/research
archiver. It says the former Solar Radiation Consortium's commercial
distribution ended on dissolution. The developer is now listed at the
University of Yamanashi; this is the developer's academic site, not a JAXA
license notice. The page requests citations to Takenaka et al. (2011) and
Takenaka et al. (2020), disclaims warranties, and permits distribution scope
to change or cease without notice. No unrestricted commercial grant was found.

The [consortium's December 17, 2025 notice](https://www.amaterass.org/news/20251217.html)
said it would dissolve at FY2025 end. Chiba CEReS planned to continue at least
past data through FY2025, while FY2026-onward provision was not guaranteed.
The newer developer pages establish a current published claim of continuing
processing; they do not independently establish uninterrupted current archive
delivery. It is therefore inaccurate to assert that all AMATERASS processing
ceased, or that the older consortium's distribution terms grant current
commercial access.

## JAXA P-Tree is a distinct delivered product and rights route

The [P-Tree FAQ, Q4-1](https://www.eorc.jaxa.jp/ptree/faq.html) explicitly
permits commercial use of qualifying Himawari data dated February 1, 2026,
00:00 UTC onward. Its table includes HSD DAT files, L1 products, and
geophysical parameters; earlier data retain the prior restrictions. Some
other products remain excluded. Older generic non-profit wording persists
elsewhere on the page, so retain the dated rule and exact product category.
The FAQ directs users to the linked research-data terms and describes account
registration for FTP access.

The [JAXA research-data terms](https://earth.jaxa.jp/en/data/policy/index.html),
sections 2.1 and 2.3, require source attribution (including derivatives) and
**advance notification to JAXA for commercial use**, though no usage fee.
The stated notification contact is `earth@ml.jaxa.jp`. This research sent
no notification and created no account.

JAXA's [SWR user guide](https://www.eorc.jaxa.jp/ptree/userguide.html) places
shortwave radiation among geophysical parameters and describes version 2.1,
NetCDF, ten-minute Level 2 data and coarser aggregates. Its Japan grid is
2701 × 2601 at approximately 1 km, covering 24–50°N, 123–150°E. The
[Japan SWR catalog](https://www.eorc.jaxa.jp/catalog/details/92) advertises
approximately fifteen minutes from observation completion to provision.
Neither page promises 2.5-minute SWR. P-Tree's 2.5-minute **raw HSD** listing
must not be presented as 2.5-minute surface irradiance.

The applicable terms, processing products, grids, and cadence differ between
these routes. Shared Himawari input or related algorithms do not transfer
one distributor's permissions to another. No credentials, account registration,
FTP sessions, protected files, irradiance data files, or outbound messages were
used in this bounded public-document check. Current RKSI values, first usable
receipt times, and operational continuity remain unmeasured. Any production
integration must separately establish the exact authorized source, commercial,
automated retrieval, retention, and display scope before activation under the
repository's server-side approval-gate policy.
