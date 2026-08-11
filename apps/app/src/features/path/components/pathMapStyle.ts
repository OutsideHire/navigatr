/**
 * Shared Path map style + palette.
 *
 * Factored out of MerchantMap so every Path map (discover MerchantMap, the
 * day-stops DayStopsMap) renders the SAME cartography with a single source of
 * truth. See MerchantMap.tsx for the full rationale behind the exact palette
 * and the OpenMapTiles / OpenFreeMap tile choice — this module carries only the
 * style builder and the shared brand colors, nothing component-specific.
 */

import type { StyleSpecification, ExpressionSpecification } from "maplibre-gl";

// ── The exact Path map palette ─────────────────────────────────────
export const COLOR = {
  land: "#efece5",
  water: "#aadaff",
  park: "#c8e6c9",
  landcover: "#d7ead0",
  building: "#e6e2da",
  road: "#ffffff", // minor + tertiary streets
  roadHighway: "#f2c56b", // motorway/trunk — Google's warm orange
  roadArterial: "#fdeeb0", // primary/secondary — pale yellow
  roadCasing: "#cfccc4",
  label: "#5f6368",
  labelHalo: "#ffffff",
} as const;

/** Signal blue — the rep "you are here" marker + route line. Shared so the
 *  discover map and the day-stops map agree on the rep treatment. */
export const REP_COLOR = "#2456E6";

// OpenMapTiles vector source + glyphs. Keyless OpenFreeMap by default; override
// for MapTiler/self-host without touching the palette.
const TILES_URL =
  (import.meta.env.VITE_MAP_TILES_URL as string | undefined) ??
  "https://tiles.openfreemap.org/planet";
const GLYPHS_URL =
  (import.meta.env.VITE_MAP_GLYPHS_URL as string | undefined) ??
  "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";

const MAJOR_ROADS = ["motorway", "trunk", "primary", "secondary", "tertiary"];
const MINOR_ROADS = ["minor", "service", "track"];

/** Zoom-interpolated line width: [zoom, px] stops, smooth exponential ramp. */
function widthRamp(stops: Array<[number, number]>): ExpressionSpecification {
  const expr: unknown[] = ["interpolate", ["exponential", 1.4], ["zoom"]];
  for (const [z, w] of stops) expr.push(z, w);
  return expr as unknown as ExpressionSpecification;
}

/**
 * The full Path map style — exact colors, our own road widths so the network
 * reads at the rep's default zoom (a minimal stock style collapses casings
 * below z14). OpenMapTiles schema (source-layers: water, transportation,
 * transportation_name, place, water_name).
 */
export function buildPathMapStyle(): StyleSpecification {
  return {
    version: 8,
    name: "navigatr-path",
    glyphs: GLYPHS_URL,
    sources: {
      // Explicit attribution overrides the provider's TileJSON credit (which adds
      // an "OpenFreeMap" label). We keep only the legally-required OpenStreetMap
      // credit (ODbL); the compact attribution control renders it behind a small ⓘ.
      omt: {
        type: "vector",
        url: TILES_URL,
        attribution: '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a>',
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": COLOR.land } },
      {
        id: "water",
        type: "fill",
        source: "omt",
        "source-layer": "water",
        paint: { "fill-color": COLOR.water },
      },
      // Green: woods/grass (landcover) then parks — the biggest "Google Maps"
      // tell after white roads. Both are standard OpenMapTiles source-layers;
      // where a tile has no such feature the layer simply draws nothing.
      {
        id: "landcover",
        type: "fill",
        source: "omt",
        "source-layer": "landcover",
        filter: ["match", ["get", "class"], ["wood", "grass", "scrub", "forest"], true, false],
        paint: { "fill-color": COLOR.landcover, "fill-opacity": 0.85 },
      },
      {
        id: "park",
        type: "fill",
        source: "omt",
        "source-layer": "park",
        paint: { "fill-color": COLOR.park, "fill-opacity": 1 },
      },
      // Building footprints fade in at street zoom (Google shows these).
      {
        id: "building",
        type: "fill",
        source: "omt",
        "source-layer": "building",
        minzoom: 14,
        paint: {
          "fill-color": COLOR.building,
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0, 16, 0.7],
        },
      },
      // Casings first (drawn under the bodies) so roads get a gray edge.
      {
        id: "road-casing-minor",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        filter: ["match", ["get", "class"], MINOR_ROADS, true, false],
        minzoom: 13,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": COLOR.roadCasing,
          "line-width": widthRamp([
            [13, 1.5],
            [16, 5],
            [20, 18],
          ]),
        },
      },
      {
        id: "road-casing-major",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        filter: ["match", ["get", "class"], MAJOR_ROADS, true, false],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": COLOR.roadCasing,
          "line-width": widthRamp([
            [6, 1],
            [12, 4],
            [16, 12],
            [20, 30],
          ]),
        },
      },
      // Road bodies on top of casings.
      {
        id: "road-minor",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        filter: ["match", ["get", "class"], MINOR_ROADS, true, false],
        minzoom: 13,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": COLOR.road,
          "line-width": widthRamp([
            [13, 0.8],
            [16, 3.5],
            [20, 14],
          ]),
        },
      },
      {
        id: "road-major",
        type: "line",
        source: "omt",
        "source-layer": "transportation",
        filter: ["match", ["get", "class"], MAJOR_ROADS, true, false],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          // Google's road skeleton: motorways/trunks orange, primary/secondary
          // pale yellow, tertiary white (falls through).
          "line-color": [
            "match",
            ["get", "class"],
            ["motorway", "trunk"], COLOR.roadHighway,
            ["primary", "secondary"], COLOR.roadArterial,
            COLOR.road,
          ] as unknown as ExpressionSpecification,
          "line-width": widthRamp([
            [6, 0.5],
            [12, 2.5],
            [16, 9],
            [20, 24],
          ]),
        },
      },
      // Labels — gray, no halo.
      {
        id: "road-labels",
        type: "symbol",
        source: "omt",
        "source-layer": "transportation_name",
        minzoom: 13,
        layout: {
          "symbol-placement": "line",
          "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
        },
        paint: { "text-color": COLOR.label, "text-halo-color": COLOR.labelHalo, "text-halo-width": 1.1, "text-halo-blur": 0.4 },
      },
      {
        id: "water-labels",
        type: "symbol",
        source: "omt",
        "source-layer": "water_name",
        layout: {
          "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
          "text-font": ["Noto Sans Italic"],
          "text-size": 12,
        },
        paint: { "text-color": COLOR.label, "text-halo-color": COLOR.labelHalo, "text-halo-width": 1.1, "text-halo-blur": 0.4 },
      },
      {
        id: "place-labels",
        type: "symbol",
        source: "omt",
        "source-layer": "place",
        layout: {
          "text-field": ["coalesce", ["get", "name:en"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            8,
            ["match", ["get", "class"], "city", 14, 11],
            14,
            ["match", ["get", "class"], "city", 20, 14],
          ],
        },
        paint: { "text-color": COLOR.label, "text-halo-color": COLOR.labelHalo, "text-halo-width": 1.1, "text-halo-blur": 0.4 },
      },
    ],
  };
}
