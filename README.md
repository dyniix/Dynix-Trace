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
```

## Stack

React 19 · Vite 8 · TypeScript (strict) · Tailwind CSS v4 · motion v13 ·
@paper-design/shaders-react (WebGL) · lucide-react

## Structure

```
src/
  App.tsx                    mounts the hero
  data.ts                    all copy: brand, nav, hero lines, CTAs, statuses,
                             session feed, game targets, modal copy
  index.css                  theme fonts + atmosphere layers
                             (vignette, scanlines, grain, shimmer, sweep)
  components/
    ui/
      hero.tsx               the whole scene — mesh gradient, nav, headline,
                             trace CTA, session feed, rotating seal
      target-modal.tsx       game-selection dialog (5 targets, confirm/cancel)
public/
  games/                     target icons (valorant, free-fire, bgmi,
                             call-of-duty, minecraft)
```

## The scene

- **MeshGradient** — two stacked WebGL layers: a flowing color field
  (black → deep cyan → ember) with a soft 60%-opacity overlay drifting on top.
  Both accelerate ≈1.5× while a trace is running.
- **Rotating seal** — `PulsingBorder` ring with "DYNIX TRACE • SAME GAME, A
  FAIRER TOMORROW • INTEGRITY CREATES BETTER GAMES" orbiting the D monogram.
- **Trace CTA** — white body and a detached arrow disc (both 52px, 12px rest
  gap kept fully clear — no glow between the shapes). On hover the whole button
  lifts and a cyan sheen sweeps the body; the shapes stay separate (no
  morph/stretch). Clicking opens the target-selection modal; after **CONTINUE**
  it flips into trace mode (spinner, "TRACING…" label, button locked) for the
  2.6 s scan, then returns to idle.
- **12 deterministic sparks** drift upward (cyan, three ember).
- **Atmosphere** — vignette + CRT scanlines + film grain, and an animated
  shimmer across the kicker line above the headline.

## Interactions

| Action | Effect |
|---|---|
| Click **INITIATE TRACE** | opens the target-selection modal |
| Select a game | row highlights, check marks it, summary + CONTINUE become active |
| Press **CONTINUE** | stores the target, closes the modal, starts the 2.6 s trace (sweep, mesh accelerates ≈1.5×, feed pulse, CTA spinner, status → SCANNING), then idles with chip `Target — <name>` |
| Press **CANCEL** / **ESC** / click outside | closes the modal, no target change |
| Hover **INITIATE TRACE** | button lifts, sheen sweep, arrow rotates 45° in place |
| Everything else | pure landing — no other state |

## Target selection

A modal dialog over the live scene (dark glass, backdrop blur — the mesh
background keeps animating behind it). Lists the five games in spec order —
01 Valorant, 02 Free Fire, 03 BGMI, 04 Call of Duty, 05 Minecraft — each with
its icon; the whole row is the click target. Single-selection: the selected
row gets a cyan tint plus a check icon (never color alone). The footer shows
the selected target and keeps **CONTINUE** disabled until a choice is made;
**CANCEL**, **ESC**, or an outside click closes without changes. **CONTINUE**
kicks off the simulated trace described above. The backdrop dims and blurs in
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
