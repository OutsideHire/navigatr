/**
 * MerchantMap — Leaflet map with merchant pins.
 *
 * Tile source: OpenStreetMap (free, no API key, just attribution).
 * Markers: CircleMarker rather than image icons so we avoid the
 * well-known Leaflet bundler problem (default marker PNGs not
 * resolving through Vite's asset pipeline) and so we can color-code
 * each pin by status with a simple SVG circle.
 *
 * The map auto-centers on the rep's position and fits a sensible
 * default zoom for "everything within a few miles". If the caller
 * passes a `focusedMerchantId`, the map flies to that pin on change.
 *
 * Mobile: fills its parent (parent decides the height). Desktop: same.
 * No internal padding — callers control layout.
 */

import * as React from "react";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, useMap } from "react-leaflet";
import type { LatLngExpression } from "leaflet";

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
  className?: string;
}

/** Internal — pans the map when the focused merchant changes. */
function FlyToFocused({
  merchants,
  focusedMerchantId,
}: Pick<MerchantMapProps, "merchants" | "focusedMerchantId">) {
  const map = useMap();
  React.useEffect(() => {
    if (!focusedMerchantId) return;
    const m = merchants.find((x) => x.id === focusedMerchantId);
    if (!m) return;
    map.flyTo([m.lat, m.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [focusedMerchantId, merchants, map]);
  return null;
}

/** Internal — pans the map when the rep's position changes (geolocation
 *  retry, etc.). MapContainer's `center` prop is init-only in react-leaflet
 *  v4, so without this the viewport stays at the initial center even
 *  after "Use my location" returns a real GPS fix. */
function FollowPosition({ position }: { position: { lat: number; lng: number } }) {
  const map = useMap();
  const lastRef = React.useRef<{ lat: number; lng: number } | null>(null);
  React.useEffect(() => {
    const last = lastRef.current;
    // Skip the first render — MapContainer already centered there.
    if (!last) { lastRef.current = position; return; }
    // Only pan when the position actually changed (avoid pan loops if a
    // parent re-renders with a new object literal but same values).
    if (last.lat !== position.lat || last.lng !== position.lng) {
      map.flyTo([position.lat, position.lng], map.getZoom(), { duration: 0.5 });
      lastRef.current = position;
    }
  }, [position, map]);
  return null;
}

export function MerchantMap({
  position,
  merchants,
  focusedMerchantId,
  onMerchantClick,
  routePath,
  className,
}: MerchantMapProps) {
  const center: LatLngExpression = [position.lat, position.lng];

  return (
    <div className={cn("relative h-full w-full overflow-hidden rounded-radius-md", className)}>
      <MapContainer
        center={center}
        zoom={13}
        scrollWheelZoom
        className="h-full w-full"
        // Leaflet's default attribution can crowd the map; we use a
        // tighter prefix and keep OSM credit (required by their tile ToS).
        attributionControl
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />

        {/* Rep position — slightly larger blue ring + filled center.
            Keeps it visually distinct from merchant pins. */}
        <CircleMarker
          center={[position.lat, position.lng]}
          radius={8}
          pathOptions={{
            color: "#2F5BFF",     // signal blue ring
            fillColor: "#2F5BFF",
            fillOpacity: 0.9,
            weight: 3,
          }}
        >
          <Tooltip direction="top" offset={[0, -8]}>You are here</Tooltip>
        </CircleMarker>

        {/* Merchant pins — color by status, click to select. */}
        {merchants.map((m) => {
          const color = STATUS_MAP_COLOR[m.status];
          const isFocused = focusedMerchantId === m.id;
          return (
            <CircleMarker
              key={m.id}
              center={[m.lat, m.lng]}
              radius={isFocused ? 10 : 7}
              pathOptions={{
                color: "#FAFAF7",       // outer ring for contrast on tiles
                fillColor: color,
                fillOpacity: 0.95,
                weight: isFocused ? 3 : 2,
              }}
              eventHandlers={{
                click: () => onMerchantClick?.(m),
              }}
            >
              <Tooltip direction="top" offset={[0, -8]}>{m.name}</Tooltip>
            </CircleMarker>
          );
        })}

        {/* Route polyline — visualizes the queued drop-in path. Dashed
            so it reads as "planned" rather than a real road route. */}
        {routePath && routePath.length >= 2 && (
          <Polyline
            positions={routePath.map((p) => [p.lat, p.lng])}
            pathOptions={{
              color: "#2F5BFF",
              weight: 3,
              opacity: 0.7,
              dashArray: "8 6",
            }}
          />
        )}

        <FollowPosition position={position} />
        <FlyToFocused merchants={merchants} focusedMerchantId={focusedMerchantId} />
      </MapContainer>
    </div>
  );
}

export default MerchantMap;
