# Quorum design system

Stance: data-dense command center, dark hive. Neo-grotesque (Geist) + Geist Mono for addresses, IDs, timestamps.

- Palette (strict): ink #0D0F12 (app bg), coal #111318 (sidebar/header), coal-2 #16181D (card), coal-3 #1B1D22 (elevated card), line #2A2618 (border), honey #FFC700 (primary), flare #FCEF3C (bright highlight), amber #FCAD17, cream #FFF1C1 (text). No blue/green/red/purple.
- Status by intensity, not hue: `idle` dim outline · `active` honey solid · `warning` amber dashed · `threat` flare fill + glow. See `Badge` / `HexDot` in `src/components/ui.tsx`.
- Surfaces: `Panel` (clipped corners, 1px honey/15 border). Buttons: primary honey on ink, secondary outline.
- Labels: 11px mono uppercase tracking-wide. Body 14px. KPI numbers 28px semibold tabular.
- Motifs: `.honeycomb` texture, `.clip-hex`, `.clip-hexcard`, `.flow` dashed path animation.
