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
  data.ts                    all copy: brand, nav, hero lines, CTAs, statuses, session feed
  index.css                  theme fonts + atmosphere layers
                             (vignette, scanlines, grain, shimmer, gooey, sweep)
  components/
    ui/
      hero.tsx               the whole scene — mesh gradient, nav, headline,
                             gooey CTA, session feed, rotating seal
```

## The scene

- **MeshGradient** — WebGL flowing color field (black → deep cyan → ember)
  with distortion, swirl and grain.
- **Rotating seal** — `PulsingBorder` ring with "DYNIX TRACE • SAME GAME, A
  FAIRER TOMORROW • INTEGRITY CREATES BETTER GAMES" orbiting the D monogram.
- **Gooey CTA** — SVG filter (blur + alpha contrast) so the white pill and the
  arrow disc merge into one blob on hover.
- **12 deterministic sparks** drift upward (cyan, three ember).
- **Atmosphere** — vignette + CRT scanlines + film grain, and an animated
  shimmer across the kicker line above the headline.

## Interactions

| Action | Effect |
|---|---|
| Click **INITIATE TRACE** | 2.6 s scan mode: mesh speeds up + brightens, a sweep crosses the screen, feed dots pulse in sequence, status flips to SCANNING |
| Hover gooey CTA | pill stretches into the arrow disc, arrow rotates 45° |
| Everything else | pure landing — no other state |

## Performance notes

Tuned for i7-4770 / RTX 3050 class hardware:

- One WebGL mesh, everything else is static CSS gradients
- Sparks and entrances animate `transform` + `opacity` only
- No canvas work outside the two shaders (mesh + seal)

## Tuning

- Colors → `colors` arrays in `hero.tsx` (mesh + seal)
- Copy → `src/data.ts` (hero lines, CTA labels, statuses, session feed)
- Seal text → `ROTATING_TEXT` in `data.ts`
