const KEY = process.argv[2];
if (!KEY) { console.log("Usage: node _test_meteofrance.mjs <api_key>"); process.exit(1); }

// Test 1: Station list for department 95 (Val d'Oise, where CDG is)
console.log("=== Test 1: Station list (DPObs) ===");
try {
  const r1 = await fetch("https://public-api.meteofrance.fr/public/DPObs/v1/station/infrahoraire-6m?id_station=07157&format=json", {
    headers: { apikey: KEY },
  });
  console.log("Status:", r1.status);
  const t1 = await r1.text();
  console.log("Response:", t1.slice(0, 500));
} catch (e) {
  console.log("Error:", e.message);
}

// Test 2: Try with different station ID format
console.log("\n=== Test 2: Station horaire ===");
try {
  const r2 = await fetch("https://public-api.meteofrance.fr/public/DPObs/v1/station/horaire?id_station=07157&format=json", {
    headers: { apikey: KEY },
  });
  console.log("Status:", r2.status);
  const t2 = await r2.text();
  console.log("Response:", t2.slice(0, 500));
} catch (e) {
  console.log("Error:", e.message);
}
