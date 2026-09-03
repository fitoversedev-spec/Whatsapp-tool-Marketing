/**
 * The wire shapes the desktop screens receive.
 *
 * Deliberately their own types rather than re-exports of `ScanResult` and
 * friends: those live in modules that `import "server-only"`, and a screen
 * payload is a narrower thing anyway. Sending the whole `ScanResult` would push
 * every place's website, phone number and opening-hours envelope into the
 * browser for a list that shows a name, a rating and a distance.
 */

import type { ScoreResult } from "@/lib/scout/scoring/types";

export interface ScanPlaceDto {
  readonly placeId: string;
  readonly name: string;
  readonly lat: number;
  readonly lng: number;
  readonly distanceM: number;
  readonly side: "competition" | "demand";
  readonly categories: readonly string[];
  readonly rating: number | null;
  readonly reviewCount: number | null;
  readonly primaryTypeDisplayName: string | null;
  readonly businessStatus: string | null;
  readonly googleMapsUri: string | null;
}

export interface ScanCategoryDto {
  readonly categoryId: string;
  readonly label: string;
  readonly side: "competition" | "demand";
  readonly count: number;
  /** True when a term in this category hit the per-search result ceiling. */
  readonly saturated: boolean;
  readonly reviewTotal: number;
  readonly avgRating: number | null;
  readonly nearestM: number | null;
}

export interface ScanProgressDto {
  readonly jobStatus: string;
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly fraction: number;
  /** "Searching football turf… (23 of 76)" — render verbatim. */
  readonly label: string;
  readonly tileCount: number;
  readonly calls: number;
  readonly cacheHits: number;
  readonly costUsd: number;
  readonly resumeRequired: boolean;
  readonly error: string | null;
}

export interface ScanSaturationTermDto {
  readonly termId: string;
  readonly termLabel: string;
  readonly saturatedTiles: number;
  readonly totalTiles: number;
}

export interface ScanScreenData {
  readonly scanId: string;
  readonly areaLabel: string;
  readonly address: string | null;
  readonly customerName: string | null;
  readonly centre: { readonly lat: number; readonly lng: number };
  readonly radiusM: number;
  readonly status: string;
  readonly categoryIds: readonly string[];

  readonly places: readonly ScanPlaceDto[];
  readonly distinctPlaces: number;
  readonly categories: readonly ScanCategoryDto[];
  readonly categoryCounts: Readonly<Record<string, number>>;

  readonly competitionCount: number;
  readonly demandCount: number;
  readonly reviewTotal: number;
  readonly avgRating: number | null;

  readonly anySaturated: boolean;
  readonly saturatedTerms: readonly ScanSaturationTermDto[];

  readonly progress: ScanProgressDto | null;
  readonly cost: { readonly calls: number; readonly cacheHits: number; readonly costUsd: number };

  /** `null` until the scan has been scored. */
  readonly score: ScoreResult | null;
  readonly scoredAt: string | null;
  /** Sparse surveyor ratings, keyed by checklist field id. */
  readonly surveyorInputs: Readonly<Record<string, number>>;
  readonly fieldNotes: string | null;
}

/** The category/preset picker payload, from `publicTaxonomy()`. */
export interface TaxonomyDto {
  readonly categories: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly side: "competition" | "demand";
    readonly anchorWeight?: number;
    readonly termCount: number;
    readonly terms: ReadonlyArray<{
      readonly id: string;
      readonly label: string;
      readonly sportFormat?: string;
    }>;
  }>;
  readonly presets: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly description: string;
    readonly categoryIds: readonly string[];
  }>;
}
