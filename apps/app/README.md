# @navigatr/app

The navigatr frontend — Vite + React 18 + TypeScript 5 + Tailwind + shadcn/ui. Mobile-first PWA.

## Quick start

From the monorepo root:

```bash
pnpm install        # install all deps for the workspace
pnpm dev:app        # http://localhost:5173
```

Or from this directory:

```bash
pnpm dev
```

## Scripts

| Script               | What it does                                                         |
| -------------------- | -------------------------------------------------------------------- |
| `pnpm dev`           | Vite dev server on :5173                                             |
| `pnpm build`         | Type-check + production build → `dist/`                              |
| `pnpm preview`       | Serve the production build locally                                   |
| `pnpm lint`          | ESLint with zero-warning gate                                        |
| `pnpm typecheck`     | `tsc -b --noEmit`                                                    |
| `pnpm format`        | Prettier write across `src/`                                         |
| `pnpm generate-api`  | NSwag → regenerates `src/api/generated/` from `packages/contracts/openapi.yaml` (Session 4) |

## Architecture

```
src/
├── api/
│   ├── client.ts        # Axios instance (Session 5 attaches Supabase JWT)
│   └── generated/       # NSwag output — gitignored, regenerated on `pnpm generate-api`
├── components/
│   ├── ui/              # shadcn/ui primitives (generated via `pnpm dlx shadcn@latest add …`)
│   ├── navigatr/        # Custom design-system components (cards, KPIs, sheets, etc.)
│   └── layout/          # TopBar, BottomNav, SidebarNav (built in Session 4–5)
├── features/            # Feature-organized
│   ├── auth/
│   ├── dashboard/
│   ├── pipeline/
│   ├── activities/
│   ├── partners/
│   ├── path/
│   └── settings/
├── hooks/               # Cross-feature React hooks
├── lib/                 # Pure utilities (cn, formatters, date helpers)
├── stores/              # Zustand stores (theme, install-prompt, current-user, etc.)
├── tokens/              # Figma token export + generated tokens.ts (Session 2)
├── App.tsx              # Root layout / router (router lands in Session 4)
├── main.tsx             # Entry — React, QueryClient, providers
├── index.css            # Tailwind + CSS vars for light/dark themes
└── pwa.ts               # Service-worker registration (added in Session 3)
```

## Stack

- **Build:** Vite 6 + `@vitejs/plugin-react`
- **Language:** TypeScript 5 (strict)
- **UI:** Tailwind CSS 3 + shadcn/ui (CSS-variable theme)
- **Routing:** React Router v6
- **Server state:** TanStack Query v5 + axios
- **Client state:** Zustand v5
- **Forms:** React Hook Form + Zod
- **Icons:** Lucide React
- **PWA:** vite-plugin-pwa + Workbox

## Path alias

`@/` resolves to `src/` everywhere (TS, Vite, ESLint, shadcn).

## Generated code

`src/api/generated/` is regenerated from `packages/contracts/openapi.yaml` and **not committed**. If imports from there break locally, run:

```bash
pnpm generate-api
```

## Installing as a PWA

navigatr is a Progressive Web App. Once it's deployed (or you're running `pnpm --filter app preview` against a production build), users can install it to their device's home screen and run it like a native app — full-screen, with its own icon, and with offline cache support for assets and recently-fetched API responses.

### iOS / iPadOS (Safari only)

1. Open the navigatr URL in **Safari** (Chrome on iOS won't show the install option — iOS only allows PWA install from Safari).
2. Tap the **Share** button (square with up-arrow) in the bottom toolbar.
3. Scroll the share sheet and tap **Add to Home Screen**.
4. Confirm the name ("navigatr") and tap **Add**.

The app icon appears on the home screen. Launching it opens navigatr in standalone mode — no Safari chrome.

### Android (Chrome, Edge, Brave, Samsung Internet)

1. Open navigatr in Chrome (or a Chromium-based browser).
2. Either:
   - Tap the **Install navigatr** button if it appears in-app (we surface it via `beforeinstallprompt`), or
   - Open the browser's **⋮ menu** → **Install app** (or **Add to Home screen**).
3. Confirm. The app appears in the launcher with the navigatr icon.

### Desktop (Chrome, Edge)

1. Open navigatr in a Chromium browser.
2. Look for the **install icon** in the address bar (a small monitor with a down-arrow, on the right side).
3. Click it → **Install**. The app gets its own window and dock/taskbar icon.

> **Dev-mode note:** PWA features (install prompt, offline cache, service worker) only activate against the **built** output, not `pnpm dev`. The dev server intentionally doesn't register the service worker — too easy to ship a stale SW into a normal dev iteration loop. To verify locally, run:
>
> ```bash
> pnpm --filter app build
> pnpm --filter app preview
> ```
>
> Then open `http://localhost:4173/` and exercise the install flow.

### Updates

`vite-plugin-pwa` is configured with `registerType: "autoUpdate"`. When a new version ships, the service worker downloads it in the background. On the user's next visit (or `updateSW(true)` call), the new version activates. Today the update signal is a `console.info` log — a real toast UI lands later.

## What's next (per `docs/frontend-implementation-playbook.md`)

| Session | Goal                                                                              |
| ------- | --------------------------------------------------------------------------------- |
| 1 ✅    | Bootstrap the monorepo + scaffold `apps/app`                                      |
| 2 ✅    | Tailwind from Figma tokens + dark-mode toggle                                     |
| 3 ✅    | PWA configuration (manifest, icons, service worker) — you are here                |
| 4       | NSwag pipeline — generated typed API client                                       |
| 5       | Supabase Auth + auth-protected routes                                             |
