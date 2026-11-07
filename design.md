---
version: "1.0"
name: "PokéAthlon Arena"
description: "Menu and HUD design system for PokéAthlon, a non-commercial 3v3 Pokémon fan game. The lobby takes its shape from Pokémon UNITE (your Pokémon on a stage, play button bottom-right) and its menu items from Omega Strikers (customize, Pokédex/info, records, settings, party, role select)."
colors:
  primary: "#FFB320"
  primary-deep: "#FF7A1A"
  secondary: "#3E8BFF"
  tertiary: "#FF4F8B"
  neutral: "#F4F2FF"
  muted: "#B9B4D6"
  surface: "#1B1640"
  surface-raised: "#2A2262"
  night: "#0E0B22"
  blue-team: "#3E8BFF"
  red-team: "#FF4F5E"
typography:
  display:
    fontFamily: "system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: "clamp(2rem, 4.2vw, 3.4rem)"
    fontWeight: 900
    fontStyle: italic
  h1:
    fontFamily: "system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: 1.6rem
    fontWeight: 800
  body-md:
    fontFamily: "system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: 0.875rem
    fontWeight: 400
  label:
    fontFamily: "system-ui, Segoe UI, Roboto, sans-serif"
    fontSize: 0.75rem
    fontWeight: 700
    letterSpacing: 0.06em
rounded:
  sm: 6px
  md: 12px
  lg: 18px
  pill: 999px
components:
  button-play:
    backgroundColor: "linear-gradient({colors.primary}, {colors.primary-deep})"
    textColor: "#FFFFFF"
    skew: -8deg
    padding: 18px 48px
  button-side:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.neutral}"
    rounded: "{rounded.md}"
  panel:
    backgroundColor: "rgba(20, 16, 48, 0.78)"
    border: "1px solid rgba(255,255,255,0.14)"
    rounded: "{rounded.lg}"
---

## Overview

PokéAthlon is an arcade sport: bright, fast and readable. The menus should feel like walking into a stadium before a match.

**Lobby layout.**
- The live 3D stadium sits behind, dimmed.
- Your **main Pokémon** stands on a glowing platform in the centre.
- Everything you can do sits around the edges, never on top of the Pokémon.

**Two references.**
- **Pokémon UNITE** gives the overall composition:
  - profile card top-left;
  - party column on the left;
  - quick icons on the right;
  - the big slanted orange battle button bottom-right.
- **Omega Strikers** gives the menu items:
  - your Pokémon's name is the switcher;
  - a role select (Goalie / Flex / Forward) sits above the play button;
  - a Pokédex/info page shows each Pokémon's moves, cooldowns and hit types, plus your own stats with it;
  - **Customize** (main Pokémon and held items per role);
  - **Records** (the leaderboard: your top Pokémon, wins and losses);
  - **Settings**.

**What's not in the game.** It's non-commercial, so there's no store, no paid currency, no battle pass and nothing that looks like a purchase. Progress (trainer level, records) is earned only by playing.

- Density: 4/10. The Pokémon is the hero; panels are compact and pushed to the edges.
- Variance: 6/10. Slanted CTAs and skewed tabs against straight panels.
- Motion: 6/10. Idle sprite animation, a soft platform glow and short slide-ins. Nothing loops in a distracting way.

- **Style:** sports-arcade lobby, night stadium, glassy panels, pixel-art Pokémon (PMD sprites, `image-rendering: pixelated`).
- **Light/Dark:** dark only. The game's 3D scene sets the mood.

## Colors

- **Battle Orange** (#FFB320 → #FF7A1A): the play button, the selected tab, the active role. One per screen.
- **Arena Blue** (#3E8BFF): your team, links, focus rings, the XP bar.
- **Spotlight Pink** (#FF4F8B): notification dots, "new", the party "+" invite.
- **Red Team** (#FF4F5E): the enemy team only. Never used for errors next to team colour.
- **Night Surface** (#1B1640 / #2A2262): panels and side buttons, always semi-transparent over the scene.
- **Ink** (#F4F2FF) and **Muted** (#B9B4D6): text. Never pure black or pure white panels.

Tier colours (T0 → F) keep their existing scale from the pick screen.

## Typography

- **Display:** heavy italic system sans for the play button, the Pokémon's name and big banners (UNITE's slanted energy).
- **Headings:** weight 800, upright.
- **Body:** 14px/1.4 system sans.
- **Labels:** 12px uppercase, weight 700, +0.06em tracking, for chips such as role, mode and tier.
- **Numbers:** `font-variant-numeric: tabular-nums` in records and stats.

## Layout

The lobby uses one fixed full-screen layer over the 3D canvas, in five regions:

| Region | Position | Content |
|---|---|---|
| Profile | top-left | portrait of the main, trainer name, level, XP bar |
| Party / side menu | left column | party slots (you plus "+" invites that open online rooms), then Pokédex, Customize, Records, Settings |
| Utility | top-right | trainer level and wins, settings gear |
| Stage | centre | main Pokémon sprite (drag to spin), name and switcher |
| Play | bottom-right | role select, mode select, Play button |

- Pages (Pokédex, Customize, Records, Settings) open as one large panel that slides over the lobby with a header and a Back button. Esc, B and Back always return.
- Below 820px width the side menu turns into a bottom tab row, and the Play block takes the full width.
- z-index contract: game canvas (0) / HUD (10) / lobby (40) / pick screen (50) / page panel (60) / toast (100).

## Elevation & Depth

- Panels: translucent night surface, 1px light border, `backdrop-filter: blur(6px)`, shadow `0 8px 30px rgba(0,0,0,.35)`.
- The stage platform is an ellipse with a radial glow in Arena Blue under the Pokémon, plus a soft shadow.
- Hover and focus: lift 2px plus a brighter border. Keyboard and gamepad focus always shows a 2px Arena Blue ring.
- Motion: panel slide-in of 180ms ease-out (translateX 24px → 0) with opacity. Only `transform` and `opacity` animate.

## Shapes

- Panels use 18px corners; side buttons and cards 12px; chips are pills.
- The play button and the role/mode tabs are skewed −8° (with the text counter-skewed) for the UNITE slant.

## Components

- **Play button:** orange gradient, skewed, display type. It shows the mode underneath ("vs CPU · Forward"). Hover brightens; active presses down 2px.
- **Role select:** three skewed tabs (Goalie / Flex / Forward). Flex picks a role at random for each match.
- **Mode select:** Quick match (straight in with CPU picks), Custom match (the pick screen), Practice, Watch CPU, Online.
- **Side button:** icon (inline SVG) plus a label, stacked in the left column.
- **Party slot:** a round portrait. Empty slots show a pink "+" that opens online play to invite friends.
- **Pokémon card (Pokédex):** portrait, archetype, stats, forward and goalie tiers, each move with its slot, cooldown and description, then "Your stats" (games, wins, goals, KOs) and a "Set as main" button.
- **Records table:** per Pokémon, with tabular numbers, sorted by games played. The top three are shown as podium cards.

## Do's and Don'ts

- Do keep the main Pokémon visible and big. The lobby is about it.
- Do make every control reachable with mouse, keyboard and gamepad (D-pad + A, B = back).
- Do use the PMD sprites and portraits with pixelated scaling. No blurred upscales.
- Don't add stores, prices, paid currencies, loot boxes or anything that suggests buying.
- Don't use Omega Strikers or UNITE art, logos or names in the UI. They're layout references only.
- Don't use emoji as icons: use inline SVG.
- Don't cover the stage with panels on the lobby screen.
- Don't use pure #000 or #FFF surfaces.
