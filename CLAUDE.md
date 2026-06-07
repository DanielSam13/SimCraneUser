# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**SimCrane User** is a Portuguese-language Progressive Web App (PWA) for administering user accounts on the SimCrane Pro platform. It is a **client-side-only static app** — no build step, no bundler, no backend server. All data persistence and auth is handled by Supabase.

## Development Commands

```bash
npm start        # Start local dev server at http://localhost:3000 (alias: npm run dev)
npm run deploy   # Deploy to production via Vercel CLI
```

No build, test, or lint step exists. The app runs directly from static files.

## Architecture

The entire application lives in four files:

| File | Role |
|------|------|
| `index.html` | Two-screen shell: `#auth-container` (login) and `#dashboard-container` (admin panel) |
| `app.js` | All application logic (~679 lines, vanilla JS, no framework) |
| `index.css` | Full design system (dark/neon theme, glassmorphism) |
| `sw.js` | Service Worker — stale-while-revalidate cache for app shell only; never caches Supabase calls |

### app.js structure

The file is organized top-to-bottom in execution order:

1. **Supabase init** — client created with hardcoded URL/anon key; `ADMIN_EMAIL_LIMIT` restricts dashboard access to one email.
2. **DOM cache** — all element references captured at module load.
3. **State** — `profiles[]` (all users), `currentUser`, `realtimeSubscription`, `notifiedUsers` Set.
4. **Utilities** — `fmtDate`, `fmtDateTime`, `getStatus()` (derives admin/pending/trial/licensed/expired from profile fields), `showToast()`, `sendNotification()`, `checkUserAlerts()`.
5. **Real-time** — `subscribeToProfiles()` opens a Supabase channel on the `profiles` table and re-renders + alerts on any change.
6. **Auth** — `checkSession()` (guards the dashboard), `handleLogin()`, `handleLogout()` (also unsubscribes real-time).
7. **CRUD** — `fetchProfiles()`, `patchProfile()`, `toggleApproval()`, `extendTrial()`, `saveLicense()`, `deleteUser()` (calls `delete_user` Supabase RPC), modal open/close/submit handlers.
8. **Render** — `renderProfiles()` filters the in-memory `profiles[]` array and rebuilds the table DOM; called after every mutation.
9. **Event listeners + `checkSession()` call** — wires everything up and boots the app.

### Data flow

```
Supabase auth → checkSession() → fetchProfiles() + subscribeToProfiles()
                                         ↓
                                  profiles[] (in-memory)
                                         ↓
                               renderProfiles() (full re-render)
                                         ↓
                           patchProfile / toggleApproval / etc.
                                         ↓
                               renderProfiles() again
```

### Status logic (`getStatus`)

User status is derived from profile fields in this priority order:
`admin` → `pending` (not approved) → `trial` (within 14-day window) → `licensed` (has future `license_expiry`) → `expired`.

### PWA / Service Worker

Cache name is `simcrane-user-cache-v1`. When updating cached assets, bump this version in `sw.js`. Vercel is configured to send `no-store` headers for `sw.js` and `manifest.webmanifest` so browsers always fetch the latest worker.

## Key Conventions

- **Language**: All UI text and comments are in **Portuguese (Brazilian)**.
- **No modules**: `app.js` uses `type="module"` in HTML but everything is in one file — no imports from local files.
- **External imports**: Supabase SDK is loaded from the ESM CDN (`https://esm.sh/@supabase/supabase-js@2`). No npm install needed.
- **Styling**: CSS classes use kebab-case (`btn-primary`, `glass-card`). Status colors: amber = primary actions, green = success/licensed, red = danger/expired, blue = info, purple = admin.
- **Async pattern**: All Supabase calls use `async/await` with destructured `{ data, error }`.
- **Re-render strategy**: After any mutation, call `renderProfiles()` immediately — there is no optimistic update or virtual DOM diffing.
- **Supabase credentials** are hardcoded in `app.js` (anon/publishable key — this is intentional for a client-side app using Supabase RLS).

## Deployment

- Production is hosted on **Vercel**. Push to the main branch triggers automatic deployment.
- `vercel.json` sets cache-control headers — do not remove the `sw.js` / `manifest.webmanifest` no-cache rules or PWA updates will be delayed.
