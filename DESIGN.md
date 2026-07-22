# ShowTime — Design System

Read this before touching any UI. All values below are the single source of truth; `styles.css` implements them as CSS variables in `:root`.

## Concept

"On stage, after dark." ShowTime is a recording studio, not a dashboard. The UI is a dark stage; the user's content (preview canvas, recorded video) is the spotlight. Everything else stays quiet: low-contrast chrome, one warm accent, no decoration that competes with the video.

Principles:
1. **Content is the hero.** The canvas/player gets maximum size and contrast; controls are subordinate.
2. **One accent.** Spotlight amber for primary actions and focus. Record/stop use signal red. Nothing else is colored.
3. **Calm states.** State changes (recording, paused, saved, error) are communicated by the status bar and the timer — never by flashing panels.
4. **Everything on the 4px grid.**

## Color tokens

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0D0F13` | App background (stage) |
| `--surface` | `#15181E` | Panels |
| `--surface-2` | `#1D212A` | Inputs, cards, nested surfaces |
| `--surface-3` | `#262B36` | Hover states |
| `--border` | `#262B36` | Panel borders |
| `--border-strong` | `#343B49` | Input borders, hover borders |
| `--text` | `#EDEFF3` | Primary text |
| `--text-dim` | `#9AA1B0` | Secondary text, labels |
| `--text-faint` | `#6B7280` | Hints, file paths |
| `--accent` | `#F5A623` | Primary buttons, focus rings, active slider |
| `--accent-hover` | `#FFB84D` | Primary hover |
| `--accent-ink` | `#1A1204` | Text on accent |
| `--rec` | `#E5484D` | Record button, timer, stop |
| `--rec-hover` | `#F2555A` | Record hover |
| `--ok` | `#46A758` | Success confirmations |

Rules: accent never used for text on dark (contrast trap) except numbers/icons ≥ 18px. Body text only `--text` / `--text-dim`.

## Typography

Font stack: `'Inter', 'Segoe UI', system-ui, sans-serif`. Mono: `'Cascadia Code', Consolas, monospace`.

| Role | Size / weight | Use |
|---|---|---|
| Display | 28 / 700 | Countdown context only |
| Title | 20 / 650 | App name |
| Section | 13 / 600, uppercase, letter-spacing 0.08em, `--text-dim` | Panel headers |
| Body | 14 / 400 | Controls, labels |
| Small | 12.5 / 400 | Hints, captions |
| Mono | 12.5 | Paths, timer (timer 18/600) |

## Spacing & shape

- Grid: 4px. Common steps: 8 / 12 / 16 / 20 / 28.
- Panel padding: 20px. Gap between panels: 16px.
- Radius: panels 14px, controls 9px, buttons 9px (record button pill 999px), canvas/video 12px.
- No shadows on panels (flat stage); modal gets `0 24px 64px rgba(0,0,0,0.5)`.

## Components

**Buttons** — height 38px, padding 0 18px, weight 550.
- Primary (accent bg, `--accent-ink` text): one per view max.
- Ghost (transparent, `--border-strong` border): everything secondary.
- Danger (red bg): Stop only.
- Record: pill, red bg, white text, dot glyph, height 44px — the biggest button on screen.

**Inputs / selects** — `--surface-2` bg, `--border-strong` border, 9px radius, height 36px. Focus: 2px `--accent` ring (`outline`), no glow.

**Sliders** — `accent-color: var(--accent)`.

**Canvas & player** — 12px radius, `#000` letterbox, 1px `--border` outline. Nothing overlaps them except the countdown overlay.

**Countdown overlay** — full-canvas scrim `rgba(0,0,0,0.65)`, number 120/700 white, no animation beyond the tick.

**Timer** — mono 18/600 in `--rec`, preceded by a pulsing 8px red dot (the only animation while recording; pauses when paused).

**Status bar** — single line, `--surface` panel. Info: `--text-dim`. Error: `--rec` text + border. Success (contains "Saved"): `--ok` border.

**Source cards** — `--surface-2`, 10px radius, thumbnail 16:10 letterboxed on `#000`. Hover: border `--accent`. Kind chip: 11px uppercase `--text-faint`.

**Modal** — centered, max-width 880px, scrim `rgba(0,0,0,0.65)`.

## Motion

- Transitions: `background 120ms, border-color 120ms` only. No transforms, no easing showcases.
- Recording dot: 1.2s opacity pulse.
- Respect `prefers-reduced-motion: reduce` → kill the pulse.

## Don'ts

- No gradients, no glassmorphism, no glow shadows.
- No second accent color.
- No color-only state communication (always pair with text).
- Don't shrink the canvas to fit more chrome — shrink the chrome.
