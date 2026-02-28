## Evaluation Plan (Updated)

### Current baseline (already implemented)

- METAR data collection is already in place.
- Official high temperature persistence is already in place.
- `finalizeDay` already stores the highest recorded value, so this should not be reimplemented.

### Do not add

- No duplicate METAR ingest pipeline.
- No second “daily high from METAR” write path.
- No rework of existing official-high persistence unless a bug is identified.

### Remaining work

1. Add forecast high-duration metrics so misses are explainable:
   - `predictedHighCountHours`
   - `predictedHighStreakHours`
   - `predictedHighStreakStartEpochMs`
   - `predictedHighStreakEndEpochMs`
2. Update the daily forecast summarization logic to compute those fields.
3. Store those fields with each prediction snapshot.
4. Expose the new metrics in diagnostics/UI where forecast vs actual is compared.

### Optional validation

- Confirm AccuWeather current-conditions update cadence by logging `EpochTime` over time before increasing poll frequency.
