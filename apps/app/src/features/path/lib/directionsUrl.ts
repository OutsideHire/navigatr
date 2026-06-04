/**
 * directionsUrl — a universal Google Maps "directions to destination" deep link.
 * On mobile this opens the native maps app with directions from the device's
 * current location to the stop. Coordinates are exact, so no address parsing.
 */
export function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}`;
}
