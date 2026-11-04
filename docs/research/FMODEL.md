# Pass 2: reading Omega Strikers' data with FModel

Goal: get the exact numbers the wiki doesn't have: match rules, ball physics, arena sizes, timers, XP curve and all
ability values. See the open questions at the end of [omega-strikers.md](omega-strikers.md).

What we know about the files: `OmegaStrikers/OmegaStrikers/Content/Paks/base-game-assets.pak` is **pak version 11,
not encrypted** (no AES key needed).

## 1. Install (you do this part)

1. Download the latest release of **FModel** from its official GitHub page: <https://github.com/4sval/FModel/releases>.
   It also needs the .NET Desktop Runtime, and the installer will prompt you if it's missing.
2. Run FModel. In the first-run dialog:
   - **Game directory** → `E:\agent-projects\PokéAthlon\OmegaStrikers\OmegaStrikers\Content\Paks`
   - **UE version** → `GAME_UE4_27` (if assets fail to load, try `GAME_UE4_26`)
   - Leave the AES key empty.
3. FModel may offer to download the Oodle decompression library. Accept it, because UE games use it for compression.

## 2. Export (JSON only, no art or audio)

Set **Settings → General → Output directory** to:

```
E:\agent-projects\PokéAthlon\docs\research\fmodel-export
```

This folder is git-ignored, so nothing exported ever gets committed.

Then in the archive tree, right-click each folder below and choose **Save Folder's Packages Properties (.json)**:

| What | Where to look (names may differ a little) |
|---|---|
| Data tables & curves (stats, XP, abilities) | Any folder named `Data`, `DataTables`, `Curves`, `Balance`, `Tuning` |
| Characters / abilities | `Characters`, `Strikers`, `Abilities`, `GameplayAbilities`, `Heroes` |
| Game modes & rules | `GameModes`, `Modes`, `Rules`, `Match` |
| Core (ball) | anything named `Core`, `Puck`, `Ball` |
| Arenas (layout data, not meshes) | `Maps` or `Arenas`: export only `.umap` *properties* |
| Gear / awakenings | `Gear`, `Awakenings`, `Items`, `Perks` |
| All in-game text | `Localization/Game/en/Game.locres` → right-click → **Save Properties (.json)** |

If you're not sure where to look: export the whole `OmegaStrikers/Content` folder's **properties as JSON** and skip
textures, meshes and audio. It's bigger, but I can search through it.

## 3. Hand-off

Tell me when the export is done. I'll read the JSON, answer the open questions, and fill in
`omega-strikers.md` §9 with exact values.

**Rules we keep:** this data is for our private design reference. We don't ship, publish or commit any extracted file,
and we don't reuse OS names, art, audio or code.
