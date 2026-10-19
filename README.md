# DYNIX TRACE

Integrity console for competitive gaming — concept UI.

**Scan the signal. Trace the evidence. Reveal the truth.**

100% legit branding concept. No cheats, no game modification, nothing here
touches a game process.

## Run

```powershell
npm install
npm run dev
```

→ **http://localhost:5175/** (5175 stays clear of the portfolio's 5173)

```powershell
npm run build      # tsc --noEmit + vite build
npm run typecheck
npm test           # frontend unit tests (vitest + Testing Library)
```

## Local backend (AI configuration)

The `server/` workspace is a local-only Node.js backend (Fastify + SQLite via
`node:sqlite`, TypeScript run directly by Node — no build step). It stores
scan-job data for a future scanner and owns the AI provider configuration.

```powershell
npm run dev:all    # frontend (Vite, :5175) + backend (Fastify, :3001) together
npm run dev        # frontend only
npm run dev:server # backend only (same as: cd server && npm run dev)
```

First time only: `cd server; npm install`.

The frontend's **AI ACTIVE** control (inside the online status chip,
top-right) opens a glass panel matching the target-selection modal: pick a provider
(OpenAI, Anthropic, OpenRouter, Groq, Ollama, or any OpenAI-compatible
custom endpoint — glass popup selector), set base URL / model / API key
(password field with a show/hide control), tune an optional **Advanced**
section (request timeout, max retries, organization ID), then
**Test Connection**, **Save Configuration**, or **Reset** (two-step
confirmation). A connection status line reports NOT CONNECTED /
TESTING CONNECTION / CONNECTED / CONNECTION FAILED based on real
backend probes — never simulated. The key is sent to the local backend
and stored on disk there — it never lives in the browser or the bundle, and
the API only ever reports `hasApiKey`. The backend blocks SSRF-style base
URLs (loopback/private/metadata addresses) except for Ollama or with
`DYNIX_ALLOW_LOCAL_AI=true`, and all admin routes are loopback-only.

See `server/README.md` for env vars, the full API table, and the security
model (including current limitations: no auth yet).

## Trace console

**EXPLORE CONSOLE** on the hero (and the `#console` hash) opens the real
console — hash-routed, no router dependency. It reads live capabilities from
the local scanner API and streams the backend's event feed into a fixed
terminal window (red lines mark high-risk evidence, amber marks warnings —
never decorative). Progress shows the current stage as a fraction of six
(never fake percentages); cancel is two-step. Scans start in exactly one
place: the hero's **INITIATE SCAN** button — the console is a viewer, so it
never offers a start control of its own. When the console opens it
auto-selects the newest recorded scan and, if one is still running, streams
it live. A custom dropdown scan picker switches between recorded runs, and
polling degrades honestly: if the backend goes away mid-scan, the feed pauses
and says so instead of inventing failures. The page itself never scrolls: the
whole screen is one fixed window sized to the viewport, the terminal takes
the leftover height, and the scan id, lifecycle badge, stage, counts and
report link live in the status row beneath it.

While a scan is being watched in the console, its completion auto-opens the
evidence browser at `#evidence/<scanId>`: a deterministic **heuristic** risk
score (0–100, banded
LOW / MODERATE / ELEVATED / HIGH) computed from transparent, capped rule
weights over persisted evidence — masquerading system-binary names, unsigned
or invalid executables in user-writable and temp locations — plus honest
statistics (signature and hash coverage, path classes) and the full findings
and process-evidence tables. Reports export as JSON (download or copy). Every
empty, offline, unavailable and invalid-response state stays honest; nothing
is simulated.

## Evidence + Docs

The **Evidence** page (`#evidence`, `#evidence/<scanId>`) is a per-scan
evidence browser inside a liquid-glass window: a custom dropdown scan picker
(it opens the newest recorded trace automatically), the heuristic risk score
as a ring with its factors and a LOW→HIGH band scale, evidence-summary tiles
with coverage bars (records, signatures, SHA-256 coverage, path classes),
trace metadata, the findings panel, and the paginated process-evidence table
— a fixed layout that always fits its window (cells truncate with full values
on hover; no horizontal scroll anywhere). The scan's lifecycle status lives in
a glass footer bar along the bottom of the window — scan id, status badge and
process/finding counts — keeping the toolbar focused on picking and exporting.
Internal scroll only, the page itself never scrolls (`#docs/<scanId>` URLs
from older builds redirect here).

The **Docs** page (`#docs`) is the project README as a page: the overview, the
six-stage scan workflow (start → collect → normalize → inspect → rules →
report), the three detection rules with their weights, the risk bands, the
local API surface, and the honest limits — same fixed-size liquid-glass
window with a prismatic rim and aurora light behind it, internal scroll only,
with breathing room at the bottom.

`src/lib/scanner-api.ts` is the typed client (validates response shapes,
maps errors to `ScannerApiError`, dedupes StrictMode's duplicate GETs),
`use-scan-polling.ts` owns the job polling loop, `use-scan-events.ts` owns
the live event cursor (deduped by sequence number), and
`src/components/console/*` + `src/components/evidence/*` +
`src/components/docs/*` own the UI. The backend serves the feed and the
report over `GET /api/scanner/scans/:id/events` and
`GET /api/scanner/scans/:id/report` (see `server/README.md`). Frontend tests
(`npm test`, 49) cover the client contract, the console states, the evidence
browser (auto-open, picker switching, report states) and the docs page.

## Stack

React 19 · Vite 8 · TypeScript (strict) · Tailwind CSS v4 · motion v13 ·
@paper-design/shaders-react (WebGL) · lucide-react
Backend: Fastify 5 · node:sqlite · zod 4

## Structure

```
src/
  App.tsx                    hash router + persistent scene + route
                             transitions — #console → console,
                             #evidence[/<scanId>] → evidence browser,
                             #docs → documentation, everything else → hero
  data.ts                    all copy: brand, nav, hero lines, CTAs, statuses,
                             session feed, game targets, modal + AI config
                             + console + evidence + docs copy
  index.css                  theme fonts + atmosphere layers
                             (vignette, scanlines, grain, shimmer, sweep)
                             + liquid-glass tokens (:root tint/blur/rim),
                             glass window surfaces + footer strip utility,
                             liquid-glass dropdown panels, prismatic rims and
                             aurora glow + modal/panel styles
  lib/
    ai-config.ts             typed client for the local backend AI config API
    scanner-api.ts           typed client for the local scanner API
    use-scan-polling.ts      scan polling with backoff + degraded state
    use-scan-events.ts       event-feed cursor polling for the live terminal
    active-scan.ts           the single home-initiated scan: instant lock,
                             run-until-terminal polling, reload adoption
                             (makes parallel home scans impossible)
    scan-format.ts           status labels, timestamps, sizes, durations
  components/
    ui/
      scene-background.tsx   the one persistent background — mesh layers,
                             atmosphere, sparks + the boost context pages
                             use to accelerate it
      hero.tsx               the home screen — nav, headline, initiate-scan
                             CTA (starts the real scan), session feed,
                             rotating seal
      terminal.tsx           the fixed-window terminal (live + scripted modes)
      target-modal.tsx       game-selection dialog (5 targets, confirm/cancel)
      ai-config-panel.tsx    AI provider configuration dialog (glass panel)
      scan-dropdown.tsx      custom listbox dropdown for scan picking
                             (console + evidence)
      monogram.tsx           shared D monogram + gradient defs
    console/
      console-view.tsx       viewer-only console — terminal feed, scan
                             dropdown, status row
      scan-status.tsx        scan-status / signature / field chips
      evidence-table.tsx     paginated process evidence + detail rows
      findings-list.tsx      findings with severity and evidence references
    evidence/
      evidence-view.tsx      evidence browser (#evidence + per-scan report:
                             risk ring, coverage-bar stats tiles, metadata,
                             findings, fixed-layout evidence table, scan
                             dropdown, segmented JSON export)
    docs/
      docs-view.tsx          documentation page — README, workflow, rules
server/                      local backend — see server/README.md
public/
  games/                     target icons, pre-scaled to 256px for the 44px
                             UI frames (valorant, free-fire, bgmi,
                             call-of-duty, minecraft)
```

## The scene

The scene is **mounted once at the app root and never reloads**: the console,
evidence browser and docs all sit on the exact same background as the home
screen. Switching pages only swaps the foreground content — a calm fade-out /
lift-in (≈0.45 s out, 0.75 s in; instant under reduced motion) — while the
background keeps flowing, unbroken. The sliding page is clipped to the
viewport while it animates, so a hop never flashes a scrollbar. Picking a
different scan inside the evidence browser swaps content in place (the glass
window stays put).

- **MeshGradient** — two stacked WebGL layers: a flowing color field
  (black → deep cyan → ember) with a soft 60%-opacity overlay drifting on top.
  One set of canvas nodes lives for the whole session; both layers accelerate
  ≈1.5× while a trace is running (hero) or while a scan is live (console).
- **Rotating seal** — `PulsingBorder` ring with "DYNIX TRACE • SAME GAME, A
  FAIRER TOMORROW • INTEGRITY CREATES BETTER GAMES" orbiting the D monogram.
- **Trace CTA** — white body and a detached arrow disc (both 52px, 12px rest
  gap kept fully clear — no glow between the shapes). On hover the whole button
  lifts and a cyan sheen sweeps the body; the shapes stay separate (no
  morph/stretch). Clicking opens the target-selection modal; after **CONTINUE**
  a real scan starts on the local backend and the button becomes **TRACING…**
  (spinner, mesh accelerates ≈1.5×) while the scene sweep plays out — the app
  stays on the home screen. The console opens only when you ask it to
  (**EXPLORE CONSOLE** or the top **CONSOLE** nav). If the scan can't start,
  the scene returns to idle and an inline notice appears under the button.
- **Glass chrome** — the evidence and docs windows, their toolbars and footer
  strips are cut from one token-tuned liquid glass (`:root` tokens in
  `index.css`: tint, blur, rim, top-edge highlight) so both pages read as the
  same material over the shared scene.
- **12 deterministic sparks** drift upward (cyan, three ember).
- **Atmosphere** — vignette + CRT scanlines + film grain, and an animated
  shimmer across the kicker line above the headline.

## Interactions

| Action | Effect |
|---|---|
| Click **INITIATE SCAN** | opens the target-selection modal |
| Select a game | row highlights, check marks it, summary + CONTINUE become active |
| Press **CONTINUE** | stores the target, closes the modal, starts a real scan on the backend (sweep, mesh accelerates ≈1.5×, CTA becomes **TRACING…** with a spinner, status → SCANNING). Stays on the home screen; open the console whenever you want to watch |
| Press **CANCEL** / **ESC** / click outside | closes the modal, no target change |
| Hover **INITIATE SCAN** | button lifts, sheen sweep, arrow rotates 45° in place |
| Backend refuses the scan | scene returns to idle, inline error notice under the CTA |

## Target selection

A modal dialog over the live scene — a liquid-glass panel (soft teal/gold
internal reflections, fine top-edge highlight) — the backdrop's blur does the
frosting so the icons stay pin-sharp, with the
mesh background kept visible behind it. Lists the five games in spec order —
01 Valorant, 02 Free Fire, 03 BGMI, 04 Call of Duty, 05 Minecraft — each with
its icon; the whole row is the click target. Single-selection: the selected
row gets a cyan tint plus a check icon (never color alone). The footer shows
the selected target and keeps **CONTINUE** disabled until a choice is made;
**CANCEL**, **ESC**, or an outside click closes without changes. **CONTINUE**
starts a real scan on the local backend and plays the trace animation on the
home screen (the console is opened by choice, not automatically). While that
scan is queued or running the CTA is locked as **TRACING…** — leaving the page
and coming back resumes it, and a page reload re-adopts the running scan from
the backend — so clicks can never spawn parallel scans. The lock releases the
moment the scan reaches a terminal state (completed, failed, or cancelled);
if the backend refuses the start, the scene returns to idle with an inline
notice under the CTA. The backdrop dims and blurs in
together on a single ramp (no brightness pop). Focus is trapped in the dialog
while open and returns to the CTA on close. Reduced-motion users get instant
open/close transitions.

## Performance notes

Tuned for i7-4770 / RTX 3050 class hardware:

- Two WebGL mesh layers + the pulsing seal, everything else is static CSS gradients
- Sparks and entrances animate `transform` + `opacity` only
- No canvas work outside the two shaders (mesh + seal)

## Tuning

- Colors → `colors` arrays in `hero.tsx` (mesh + seal)
- Copy → `src/data.ts` (hero lines, CTA labels, statuses, session feed, modal copy)
- Targets → `GAMES` in `data.ts` (label, icon path, spec order); icons live in `public/games/`
- Seal text → `ROTATING_TEXT` in `data.ts`
