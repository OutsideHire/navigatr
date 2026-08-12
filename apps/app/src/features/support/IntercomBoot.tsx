/**
 * IntercomBoot. Render-null mount point for the Intercom Messenger.
 *
 * Wraps `useIntercom` in a component so AppLayout can drop it into the
 * authenticated shell without adding hook wiring to the layout itself.
 * Renders no visible UI; the Intercom floating launcher (when configured)
 * is the only surface. When VITE_INTERCOM_APP_ID is unset it is inert.
 */

import { useIntercom } from "./useIntercom";

export function IntercomBoot(): null {
  useIntercom();
  return null;
}

export default IntercomBoot;
