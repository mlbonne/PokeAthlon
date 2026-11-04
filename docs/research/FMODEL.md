# Pass 2: reading Omega Strikers' game data

## What we did (2026-11-04)

FModel is a windowed app that can't be driven from a script, so we read the archive with our own small scripts
in [`tools/research/`](../../tools/research/):

| Script | What it does |
|---|---|
| `pak.py` | Lists and extracts files from `base-game-assets.pak` (pak v11, **uncompressed, unencrypted**). 64,211 files |
| `uasset.py` | Reads a cooked asset's header and name table |
| `locres.py` | Dumps the `.locres` localization file and the StringTable assets to text |

Usage (output goes to a scratch folder, **never into the repo**):
```bash
python -I tools/research/pak.py OmegaStrikers/OmegaStrikers/Content/Paks/base-game-assets.pak list out/filelist.txt
python -I tools/research/pak.py OmegaStrikers/OmegaStrikers/Content/Paks/base-game-assets.pak extract out/os DataAssets/GameFormatData Localization/
python -I tools/research/locres.py locres out/os/OmegaStrikers/Content/Localization/Game/en/Game.locres out/game_en.txt
```

## Findings

- The engine is **Unreal 5** (UE5 engine folders present), not 4.27.
- Game content lives under `Content/Prometheus/`: `DataAssets` (AbilityData, CharacterData, GameFormatData,
  GameMapData, GameTerrainData, PowerUpData, SharedGameData, TrainingData = awakenings), `Characters`, `Maps`, `Blueprints`.
- **Text (fully readable):** 6,152 localized lines plus 11 string tables. Every ability, awakening, tutorial and
  custom-game option is described. Numbers in descriptions are placeholders such as `{HealPercent}`.
- **Internal archetype names** per striker (e.g. Kai = SpeedySkirmisher, Dubu = StalwartProtector). This is how they designed kits.
  It's now the basis of our archetype system (see [../design/GAME_BREAKDOWN.md](../design/GAME_BREAKDOWN.md) §5).
- Two unreleased kits exist in the files (Drum Oni and Kazan's umbrella stances), showing more kit patterns.
- **Numeric data is "unversioned"**: UE5 cooked assets store property values without property names. Reading them needs
  a *mappings* file (`.usmap`) dumped from the running game, and FModel needs one too. We haven't produced that,
  because it means injecting a tool into an online game, which may break its terms of service or trip anti-cheat.

## Still open → easiest way to resolve

| Question | How to get it |
|---|---|
| Default goals per set / sets per match / win-by / KO timer | Open **Custom Game → Game Settings** in OS with "Normal" selected and read the defaults |
| Overtime timing, gate delay, respawn immunity | Play a practice match and time them |
| Ball physics feel | Not needed exactly: we tune by feel in our M1 sandbox |

**Rules we keep:** extracted data stays out of git and is used only as private design reference. No OS names, art,
audio or code ship in PokéAthlon.
