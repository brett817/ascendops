# Vendored Claude Plugins

These marketplace roots are vendored into the repo so a fresh install can link
the required Claude plugins without asking the operator to add marketplaces
manually inside Claude Code.

## Pinned sources

- `caveman/`
  - upstream: `JuliusBrussee/caveman`
  - pinned rev: `84cc3c14fa1e10182adaced856e003406ccd250d`
  - plugin id: `caveman@caveman`

- `thedotmack/`
  - upstream: `thedotmack/claude-mem`
  - pinned rev: `28b40c05f2e1316948453b10e4feecce01817b6c`
  - plugin id: `claude-mem@thedotmack`

## Important shape note

Claude plugin marketplaces are rooted by marketplace owner, not always by
plugin name. `claude-mem` is the plugin name, but the installed marketplace
directory is `thedotmack/`, whose `.claude-plugin/marketplace.json` advertises
the `claude-mem` plugin from `./plugin`.
