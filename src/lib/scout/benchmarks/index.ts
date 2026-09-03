/**
 * City benchmarks — **not** deferred. The score's competitive-saturation
 * component depends on these now.
 *
 * Server-side only (`compute` and `read` import `server-only`). Pure helpers
 * live in `./aggregate` and `./city` and may be imported anywhere.
 */
export {
  hasManualOverrideColumn,
  loadScanInputs,
  MANUAL_OVERRIDE_COLUMN,
  recomputeCityBenchmarks,
  resetManualOverrideColumnCache,
  setCityBenchmarkOverride,
} from "./compute";
export type { BenchmarkOverride, RecomputeResult } from "./compute";

export { getCityBenchmark, listCityBenchmarks } from "./read";
export type { CityBenchmark } from "./read";

export { aggregateCityBenchmarks, median, MIN_SAMPLE_FOR_FORMAT_ROW } from "./aggregate";
export type {
  AggregateResult,
  AggregateSummary,
  BenchmarkFacility,
  CityBenchmarkRow,
  ScanBenchmarkInput,
} from "./aggregate";

export { canonicaliseCity, cityFromAddress, KNOWN_CITIES, resolveScanCity } from "./city";
export type { ScanLocationFields } from "./city";
