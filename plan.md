Yes—**Google now has a first-party Weather API** that’s very similar to Azure Maps Weather (current conditions + daily forecasts).

## Google equivalent: Google Maps Platform Weather API

It provides:

* **Current conditions** and **daily forecasts** (up to **10 days**) by latitude/longitude. ([Google for Developers][1])

**Current conditions (REST)**

```txt
GET https://weather.googleapis.com/v1/currentConditions:lookup?key=YOUR_API_KEY
    &location.latitude=LAT
    &location.longitude=LON
```

([Google for Developers][2])

**Daily forecast (REST)**

```txt
GET https://weather.googleapis.com/v1/forecast/days:lookup?key=YOUR_API_KEY
    &location.latitude=LAT
    &location.longitude=LON
    &days=5
```

This endpoint returns up to 10 days; `days=5` gives you a 5-day forecast. ([Google for Developers][3])

**Setup**
You enable the Weather API in your Google Cloud project and use an API key or OAuth. ([Google for Developers][4])

