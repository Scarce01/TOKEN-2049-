<!-- make-kit-guidelines -->
## Design System Setup — MANDATORY

This project depends on `@figma/astraui-kit` packages. Before writing
any code:

1. Read guidelines/setup.md and guidelines/Guidelines.md by their exact
   path (e.g. node_modules/<scope>/<package>/guidelines/setup.md).
   This project uses pnpm, which symlinks packages — do NOT use
   `find`, `glob`, or `file_search` to discover files as they silently
   fail on symlinks. Instead use: reading files by exact path,
   `ls` (follows symlinks), `find -L` (`-L` follows symlinks), or `cat`.
2. Execute all setup instructions (config changes) against THIS project — not the package itself.
3. Do not skip, modify, or improvise any setup steps.
4. Read ALL other required .md files specified in guidelines/Guidelines.md.
5. Verify that all required .md files have been read before proceeding.
<!-- /make-kit-guidelines -->

# Quorum design system

Stance: data-dense command center, dark hive. Neo-grotesque (Geist) + Geist Mono for addresses, IDs, timestamps.

- Palette (strict): ink #0D0F12 (app bg), coal #111318 (sidebar/header), coal-2 #16181D (card), coal-3 #1B1D22 (elevated card), line #2A2618 (border), honey #FFC700 (primary), flare #FCEF3C (bright highlight), amber #FCAD17, cream #FFF1C1 (text). No blue/green/red/purple.
- Status by intensity, not hue: `idle` dim outline · `active` honey solid · `warning` amber dashed · `threat` flare fill + glow. See `Badge` / `HexDot` in `src/components/ui.tsx`.
- Surfaces: `Panel` (clipped corners, 1px honey/15 border). Buttons: primary honey on ink, secondary outline.
- Labels: 11px mono uppercase tracking-wide. Body 14px. KPI numbers 28px semibold tabular.
- Motifs: `.honeycomb` texture, `.clip-hex`, `.clip-hexcard`, `.flow` dashed path animation.
