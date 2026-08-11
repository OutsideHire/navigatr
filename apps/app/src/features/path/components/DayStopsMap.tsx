/**
 * DayStopsMap — the day's stops on a MapLibre map (Robert Path v2.2, Section 2.1
 * map view + 3.1 color rule).
 *
 * Renders one NUMBERED pin per routable stop (1..N in route order), the rep's
 * current position labeled distinctly ("You"), and a small legend. Reuses the
 * exact Path cartography from ./pathMapStyle (shared with MerchantMap) so both
 * maps look identical; only the marker treatment differs:
 *
 *   COLOR encodes AGING and NOTHING else (Section 3.1) — warm range in three
 *   states (neutral before target, warm past target, hot past latest). The pin
 *   number lives inside the dot. APPOINTMENTS are marked by an outer RING, never
 *   by color, so commitment type and staleness read on independent channels.
 *
 * Retention across List/Map toggles: the map is created ONCE in a mount-keyed
 * effect (empty deps) and torn down only on unmount. The consumer hides this
 * component with CSS (e.g. `hidden`/`display:none`), which does NOT unmount it,
 * so the map instance and its GL context survive the toggle and never
 * re-initialize. (When re-shown from a zero-size container the consumer should
 * call a resize; that wiring belongs to the toggle task, not here.)
 */

import * as React from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { cn } from "@/lib/utils";
import type { OrderedStop } from "../lib/todaysPath";
import { buildDayStopPins, type AgingState, type StopPin } from "../lib/dayStopPins";
import { buildPathMapStyle, REP_COLOR } from "./pathMapStyle";

export interface DayStopsMapProps {
  /** The day's ordered run list. Input order IS the route order. */
  stops: OrderedStop[];
  /** Rep position — map centers here on first render and shows the "You" marker. */
  origin: { lat: number; lng: number };
  /** Fired when a stop pin is tapped. Surfaces the same stop the list row does. */
  onStopClick: (id: string) => void;
  className?: string;
}

/** Aging color ramp (Section 3.1, warm range). Color = staleness ONLY. */
const AGING_COLOR: Record<AgingState, string> = {
  neutral: "#64748B", // slate — before target / on time
  warm: "#F59E0B", // amber — past target
  hot: "#DC2626", // red — past the latest acceptable point
};

/** The appointment RING — a shape signifier, deliberately a fixed neutral dark
 *  so it never reads as an aging color (Section 3.1: type is shape, not color). */
const APPT_RING = "#111827";

/**
 * Build the numbered DOM pin. Circular dot in the aging color with the route
 * number centered; appointments get a white gap + dark outer ring on top of the
 * base outline. The ring is drawn with box-shadow rings so it never disturbs the
 * dot's size (no pill-avatar w!==h risk).
 */
function makeStopPinElement(pin: StopPin): HTMLDivElement {
  const el = document.createElement("div");
  const color = AGING_COLOR[pin.agingState];
  const shadows = pin.isAppointment
    ? // base contrast ring, then white gap, then the dark appointment ring
      "0 0 0 1px rgba(0,0,0,.2),0 0 0 3px #ffffff,0 0 0 5px " + APPT_RING
    : "0 0 0 1px rgba(0,0,0,.2)";
  el.style.cssText = [
    "width:24px",
    "height:24px",
    "border-radius:9999px",
    `background:${color}`,
    "border:2px solid #ffffff",
    `box-shadow:${shadows}`,
    "display:flex",
    "align-items:center",
    "justify-content:center",
    "color:#ffffff",
    "font-size:12px",
    "font-weight:700",
    "line-height:1",
    "cursor:pointer",
    "box-sizing:border-box",
  ].join(";");
  el.textContent = String(pin.index);
  el.setAttribute("data-testid", "day-stop-pin");
  el.setAttribute("aria-label", `Stop ${pin.index}${pin.isAppointment ? " (appointment)" : ""}`);
  return el;
}

/** The labeled rep-position marker — the signal-blue dot from MerchantMap with a
 *  "You" pill so it reads distinctly from the numbered stop pins. */
function makeRepElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = ["display:flex", "flex-direction:column", "align-items:center", "gap:2px"].join(";");

  const dot = document.createElement("div");
  dot.style.cssText = [
    "width:16px",
    "height:16px",
    "border-radius:9999px",
    `background:${REP_COLOR}`,
    "border:3px solid #ffffff",
    "box-shadow:0 0 0 1px rgba(0,0,0,.25)",
    "box-sizing:border-box",
  ].join(";");

  const label = document.createElement("div");
  label.textContent = "You";
  label.style.cssText = [
    "padding:1px 5px",
    "border-radius:9999px",
    `background:${REP_COLOR}`,
    "color:#ffffff",
    "font-size:10px",
    "font-weight:700",
    "line-height:1.4",
    "white-space:nowrap",
    "box-shadow:0 0 0 1px rgba(0,0,0,.15)",
  ].join(";");

  el.appendChild(dot);
  el.appendChild(label);
  return el;
}

export function DayStopsMap({ stops, origin, onStopClick, className }: DayStopsMapProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<maplibregl.Map | null>(null);
  const repMarkerRef = React.useRef<maplibregl.Marker | null>(null);
  const stopMarkersRef = React.useRef<maplibregl.Marker[]>([]);
  const popupRef = React.useRef<maplibregl.Popup | null>(null);
  const [styleLoaded, setStyleLoaded] = React.useState(false);

  // Keep the latest click handler without re-subscribing every marker.
  const onClickRef = React.useRef(onStopClick);
  onClickRef.current = onStopClick;

  const pins = React.useMemo(() => buildDayStopPins(stops), [stops]);

  // ── Create the map ONCE (mount-keyed). Never re-inits on prop change or when
  //    the parent CSS-hides us — that is the List/Map retention guarantee. ────
  React.useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildPathMapStyle(),
      center: [origin.lng, origin.lat],
      zoom: 13,
      attributionControl: false,
    });
    mapRef.current = map;
    popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14 });
    map.on("load", () => setStyleLoaded(true));
    return () => {
      map.remove();
      mapRef.current = null;
      setStyleLoaded(false);
    };
    // Create-once: `origin` is only the initial center; the rep-marker effect
    // handles later changes. Intentionally empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Labeled rep-position marker ("You") + recenter on move ────────
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded) return;
    if (!repMarkerRef.current) {
      repMarkerRef.current = new maplibregl.Marker({ element: makeRepElement() })
        .setLngLat([origin.lng, origin.lat])
        .addTo(map);
    } else {
      repMarkerRef.current.setLngLat([origin.lng, origin.lat]);
    }
  }, [origin, styleLoaded]);

  // ── Numbered stop pins (aging color; appointment ring) ────────────
  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !styleLoaded) return;
    for (const m of stopMarkersRef.current) m.remove();
    stopMarkersRef.current = [];
    for (const pin of pins) {
      const el = makeStopPinElement(pin);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onClickRef.current(pin.id);
      });
      el.addEventListener("mouseenter", () => {
        const popup = popupRef.current;
        const stop = stops.find((s) => s.id === pin.id);
        if (!popup || !stop) return;
        popup.setLngLat([pin.lng, pin.lat]).setText(stop.name).addTo(map);
      });
      el.addEventListener("mouseleave", () => popupRef.current?.remove());
      const marker = new maplibregl.Marker({ element: el }).setLngLat([pin.lng, pin.lat]).addTo(map);
      stopMarkersRef.current.push(marker);
    }
  }, [pins, stops, styleLoaded]);

  return (
    <div className={cn("relative h-full w-full", className)}>
      {/* `isolation: isolate` contains MapLibre's internal z-indexes so an
          overlaid Dialog isn't covered by the map (same fix as MerchantMap). */}
      <div ref={containerRef} className="h-full w-full overflow-hidden rounded-radius-md [isolation:isolate]" />

      {/* Legend — color = how long it has been; ring = appointment (2 lines). */}
      <div
        className="pointer-events-none absolute bottom-2 left-2 z-[1] rounded-radius-sm bg-surface-elevated/95 px-2.5 py-2 text-[11px] leading-tight text-text-muted shadow-md ring-1 ring-border-subtle"
        aria-label="Map legend"
      >
        <div className="mb-1 flex items-center gap-3">
          <LegendSwatch color={AGING_COLOR.neutral} label="On time" />
          <LegendSwatch color={AGING_COLOR.warm} label="Past due" />
          <LegendSwatch color={AGING_COLOR.hot} label="Well past due" />
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block h-3 w-3 rounded-full border-2 border-white"
            style={{ background: AGING_COLOR.neutral, boxShadow: `0 0 0 1.5px ${APPT_RING}` }}
          />
          <span>Ring = appointment</span>
        </div>
      </div>
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-full" style={{ background: color }} />
      <span>{label}</span>
    </span>
  );
}

export default DayStopsMap;
