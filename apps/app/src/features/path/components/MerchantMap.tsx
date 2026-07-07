/**
 * MerchantMap — MapLibre GL map with merchant pins.
 *
 * Engine: MapLibre GL (vector). We migrated off Leaflet/raster-OSM because the
 * brand calls for an EXACT cartographic palette (cream land, light-blue water,
 * near-white roads with a gray casing, gray labels) — and you can only recolor
 * features individually with a vector renderer, not a raster tile + CSS filter.
 *
 * Style: a purpose-built style (buildPathMapStyle) rather than recoloring a
 * stock style, so every color and road width is ours. The exact palette comes
 * from the design's Google-Maps style:
 *   land #f9f5ed · water #aee0f4 · road #f5f5f5 · road casing #c9c9c9 ·
 *   labels #878787 (no halo).
 * Roads #f5f5f5 are nearly the land color on purpose (the source style is that
 * minimal), so the #c9c9c9 casing is what actually makes the road network read.
 *
 * Tiles: OpenFreeMap (https://openfreemap.org) — free, keyless, no signup,
 * OpenMapTiles vector schema. To move to MapTiler (or any OpenMapTiles host),
 * set VITE_MAP_TILES_URL / VITE_MAP_GLYPHS_URL to that provider's endpoints;
 * the colors and layers stay identical.
 *
 * Markers are DOM elements (color-coded by status), so the status palette and
 * click handling match the old Leaflet pins. The route is a dashed GeoJSON
 * layer. The map auto-centers on the rep and flies to a focused pin / new GPS
 * fix, matching the previous behavior.
 */

import * as React from "react";
import maplibregl from "maplibre-gl";
import type { StyleSpecification, ExpressionSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { cn } from "@/lib/utils";
import { STATUS_MAP_COLOR, type Merchant } from "../mockData";

export interface MerchantMapProps {
  /** Rep position. Map centers here on first render. */
  position: { lat: number; lng: number };
  /** Pins to render. */
  merchants: Merchant[];
  /** When set, the map flies to this merchant on prop change. */
  focusedMerchantId?: string | null;
  /** Fired when a merchant pin is clicked. */
  onMerchantClick?: (m: Merchant) => void;
  /** Optional route line — draws a dashed polyline through these points
   *  in order. Used to visualize the queued drop-in path on the map. */
  routePath?: Array<{ lat: number; lng: number }>;
  /** OPTIONAL — Calendar-Aware Path (Slice 1): read-only calendar meeting pins,
   *  drawn as distinct purple, time-labeled markers. NOT added to the route
   *  polyline — they're fixed context, not curated stops. */
  calendarPins?: Array<{ id: string; lat: number; lng: number; title: string; start: string }>;
  className?: string;
}

// ── The exact Path map palette ─────────────────────────────────────
const COLOR = {
  land: "#f9f5ed",
  water: "#aee0f4",
  road: "#f5f5f5",
  roadCasing: "#c9c9c9",
  label: "#878787",
} as const;

const REP_COLOR = "#2456E6"; // signal blue — "you are here" + route line
const CALENDAR_COLOR = "#8b5cf6"; // accent-violet — calendar meeting pins

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
function buildPathMapStyle(): StyleSpecification {
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
          "line-color": COLOR.road,
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
        paint: { "text-color": COLOR.label, "text-halo-width": 0 },
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
        paint: { "text-color": COLOR.label, "text-halo-width": 0 },
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
        paint: { "text-color": COLOR.label, "text-halo-width": 0 },
      },
    ],
  };
}

/** Build the colored DOM element for a merchant pin. */
function makePinElement(color: string, focused: boolean): HTMLDivElement {
  const el = document.createElement("div");
  const size = focused ? 18 : 14;
  el.style.cssText = [
    `width:${size}px`,
    `height:${size}px`,
    "border-radius:9999px",
    `background:${color}`,
    `border:${focused ? 3 : 2}px solid #ffffff`,
    "box-shadow:0 0 0 1px rgba(0,0,0,.2)",
    "cursor:pointer",
    "box-sizing:border-box",
  ].join(";");
  return el;
}

/** Build a purple, time-labeled DOM element for a calendar meeting pin. */
function makeCalendarPinElement(label: string): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = [
    "display:flex",
    "align-items:center",
    "gap:4px",
    "padding:2px 6px",
    "border-radius:9999px",
    `background:${CALENDAR_COLOR}`,
    "border:2px solid #ffffff",
    "box-shadow:0 0 0 1px rgba(0,0,0,.2)",
    "color:#ffffff",
    "font-size:10px",
    "font-weight:600",
    "line-height:1",
    "white-space:nowrap",
    "box-sizing:border-box",
  ].join(";");
  el.textContent = label;
  return el;
}

export function MerchantMap({
  position,
  merchants,
  focusedMerchantId,
  onMerchantClick,
  routePath,
  calendarPins,
  className,
}: MerchantMapProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const userMarkerRef = React.useRef<maplibregl.Marker | null>(null);
  const merchantMarkersRef = React.useRef<maplibregl.Marker[]>([]);
  const calendarMarkersRef = React.useRef<maplibregl.Marker[]>([]);
  const popupRef = React.useRef<maplibregl.Popup | null>(null);
  const lastPosRef = React.useRef<{ lat: number; lng: number } | null>(null);
  const [styleLoaded, setStyleLoaded] = React.useState(false);

  // Keep the latest click handler without re-subscribing every marker.
  const onClickRef = React.useRef(onMerchantClick);
  onClickRef.current = onMerchantClick;

  // ── Create the map once ──────────────────────────────────────────
  React.useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildPathMapStyle(),
      center: [position.lng, position.lat],
      zoom: 13,
      // No on-map attribution control. The OSM/ODbL credit is carried off-map
      // (the source still declares `attribution: © OpenStreetMap` for compliance,
      // but nothing is rendered over the map). Surface the credit in a legal/about
      // surface if/when one exists.
      attributionControl: false,
    });
    mapRef.current = map;
    popupRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 12,
    });
    lastPosRef.current = { lat: position.lat, lng: position.lng };
    map.on("load", () => setStyleLoaded(true));
    return () => {
      map.remove();
      mapRef.current = null;
      setStyleLoaded(false);
    };
    // Create-once: position is only the initial center; the follow effect
    // handles later changes. Intentionally empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── "You are here" marker + follow on position change ────────────
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded) return;
    if (!userMarkerRef.current) {
      const el = document.createElement("div");
      el.style.cssText = [
        "width:16px",
        "height:16px",
        "border-radius:9999px",
        `background:${REP_COLOR}`,
        "border:3px solid #ffffff",
        "box-shadow:0 0 0 1px rgba(0,0,0,.25)",
        "box-sizing:border-box",
      ].join(";");
      userMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([position.lng, position.lat])
        .addTo(map);
    } else {
      userMarkerRef.current.setLngLat([position.lng, position.lat]);
    }
    const last = lastPosRef.current;
    if (last && (last.lat !== position.lat || last.lng !== position.lng)) {
      map.flyTo({ center: [position.lng, position.lat], duration: 500 });
    }
    lastPosRef.current = { lat: position.lat, lng: position.lng };
  }, [position, styleLoaded]);

  // ── Merchant pins ────────────────────────────────────────────────
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded) return;
    for (const m of merchantMarkersRef.current) m.remove();
    merchantMarkersRef.current = [];
    for (const merchant of merchants) {
      if (!Number.isFinite(merchant.lat) || !Number.isFinite(merchant.lng)) continue;
      const color = STATUS_MAP_COLOR[merchant.status];
      const focused = focusedMerchantId === merchant.id;
      const el = makePinElement(color, focused);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onClickRef.current?.(merchant);
      });
      el.addEventListener("mouseenter", () => {
        const popup = popupRef.current;
        if (!popup) return;
        popup.setLngLat([merchant.lng, merchant.lat]).setText(merchant.name).addTo(map);
      });
      el.addEventListener("mouseleave", () => popupRef.current?.remove());
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([merchant.lng, merchant.lat])
        .addTo(map);
      merchantMarkersRef.current.push(marker);
    }
  }, [merchants, focusedMerchantId, styleLoaded]);

  // ── Calendar meeting pins (read-only, purple, time-labeled) ───────
  // Mirrors the merchant-pin effect but in its own marker ref so it never
  // touches the merchant set or the route polyline.
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded) return;
    for (const m of calendarMarkersRef.current) m.remove();
    calendarMarkersRef.current = [];
    for (const pin of calendarPins ?? []) {
      if (!Number.isFinite(pin.lat) || !Number.isFinite(pin.lng)) continue;
      const time = new Date(pin.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const el = makeCalendarPinElement(time);
      el.addEventListener("mouseenter", () => {
        const popup = popupRef.current;
        if (!popup) return;
        popup.setLngLat([pin.lng, pin.lat]).setText(pin.title).addTo(map);
      });
      el.addEventListener("mouseleave", () => popupRef.current?.remove());
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map);
      calendarMarkersRef.current.push(marker);
    }
  }, [calendarPins, styleLoaded]);

  // ── Fly to the focused merchant ──────────────────────────────────
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded || !focusedMerchantId) return;
    const m = merchants.find((x) => x.id === focusedMerchantId);
    if (!m || !Number.isFinite(m.lat) || !Number.isFinite(m.lng)) return;
    map.flyTo({ center: [m.lng, m.lat], zoom: Math.max(map.getZoom(), 15), duration: 600 });
  }, [focusedMerchantId, merchants, styleLoaded]);

  // ── Route polyline (dashed) ──────────────────────────────────────
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded) return;
    const coords = (routePath ?? []).map((p) => [p.lng, p.lat]);
    const data: GeoJSON.Feature<GeoJSON.LineString> = {
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: coords },
    };
    const src = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
    if (coords.length >= 2) {
      if (src) {
        src.setData(data);
      } else {
        map.addSource("route", { type: "geojson", data });
        map.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": REP_COLOR,
            "line-width": 3,
            "line-opacity": 0.7,
            "line-dasharray": [2, 1.5],
          },
        });
      }
    } else if (src) {
      src.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } });
    }
  }, [routePath, styleLoaded]);

  return (
    // `isolation: isolate` contains MapLibre's internal z-indexes inside this
    // stacking context so a Dialog at z-40/z-50 isn't covered by the map
    // (same fix as the old Leaflet version).
    <div
      ref={containerRef}
      className={cn(
        "relative h-full w-full overflow-hidden rounded-radius-md [isolation:isolate]",
        className,
      )}
    />
  );
}

export default MerchantMap;
