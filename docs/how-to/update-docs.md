# Update these docs

The screenshots are made by a script from the built desktop bundle and a fixture of fictional
merge requests, so they cannot drift quietly: `--check` fails when the shots were not
refreshed. The prose and the wiring figure are written by hand and are checked by the steps below.

## When to rerun

Rerun the shots after any of these:

- any change under `desktop/` (the committed `plugin.js` changed);
- a new or renamed chip, button, setting or notification event;
- a change to `docs/fixtures/example.json` or to `scripts/docs-shots.mjs`;
- a new decision that changes what a screen shows.

Edit the prose when a route, a setting key or default, a chip icon, an event, or a rule changes.
Edit `wiring.svg` and the source table of `explanation/architecture.md` when a box in the figure
moves or changes.

## Prerequisites

Node 24, Chrome (`google-chrome-stable`, `chromium`, or `CHROME=<path>`) and the host's codicon
font: `CODICONS_DIR` or `~/.hermes/hermes-agent/node_modules/@vscode/codicons/dist` (the script
prints the version it found; the icon names in the decisions are for 0.0.45). No install, no
network, no Hermes backend is needed: the bundle runs against the stand-in SDK and backend in
`tests/standin/`.

## Steps

1. Build and test the desktop half first, so the shots show the committed bundle:

   ```sh
   cd <repo root>
   sh scripts/rebuild.sh
   node tests/desktop.test.mjs
   ```

2. Edit `docs/fixtures/example.json` only when a screen needs other data. It is the `GET /mrs`
   payload with fictional projects, people and Renovate bumps. Keep it fictional and ASCII, keep
   every chip kind drawn (the script fails when the pane shows no chip for an icon of `CHIP_ICON`),
   and keep `can`, `trivial` and `batch` consistent with the rules in `dashboard/mg_rules.py`.

3. Render the shots into `docs/assets/`:

   ```sh
   node scripts/docs-shots.mjs
   ```

   The clock is fixed (Friday 2026-10-23 10:00Z, UTC) and the output is byte-reproducible on one
   machine, so an unchanged screen gives an unchanged PNG. The script writes the six shots
   (`pane`, `page`, `merge-confirm`, `trivial-confirm`, `settings`, `notification`) and
   `docs/assets/shots.json`, which records the hashes of the three files the shots came from.
   Flags: `--out DIR` renders somewhere else, `--check` renders and tests without writing the
   committed files.

4. Look at every shot. No clipped text, no empty icon boxes, no name that is not in the example
   data. The shots show the plugin's own markup in a host-like frame, not the running app; the
   tooltip bubbles do not appear, and the notification is a mock.

5. Check the prose against the code. Each `path:line` of the table in
   `explanation/architecture.md` is one `sed -n '<line>p' <file>` away; the label in
   `assets/wiring.svg` must still say what that line says. Open `wiring.svg` in a browser after
   an edit.

6. Run the checks:

   ```sh
   node scripts/docs-shots.mjs --check --out "$(mktemp -d)"
   LC_ALL=C.UTF-8 grep -rInP '[\x{2013}\x{2014}\x{2026}\x{2018}\x{2019}\x{201C}\x{201D}\x{2190}-\x{21FF}]' docs README.md scripts/docs-shots.mjs
   ```

   `--check` ends with `check ok` and exit 0. The grep must print nothing.

7. Commit the docs and the shots together, in one commit with the change that caused them where
   you can.

## Files

| Path | What |
|---|---|
| `docs/fixtures/example.json` | fictional `GET /mrs` payload for the shots |
| `scripts/docs-shots.mjs` | renders the shots, `--check` tests them |
| `docs/assets/*.png`, `docs/assets/shots.json` | the shots and what they came from |
| `docs/assets/wiring.svg` | the wiring figure, edited by hand |
