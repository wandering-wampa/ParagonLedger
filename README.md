# ParagonLedger

ParagonLedger is a fully local desktop companion app for City of Heroes Homecoming.
It parses your game logs, stores activity in SQLite, and displays historical analytics.

No cloud, no telemetry, no remote services.

## MVP Scope Implemented

- Electron desktop shell (Windows-focused).
- React dashboard UI.
- Local SQLite storage in the user app-data directory.
- First-run setup prompt requiring a logs folder selection.
- Multi-account support (each account maps to its own logs folder).
- Real-time and historical log parsing from the active account logs folder.
- Automatic character creation from parsed log events.
- Badge unlock tracking and timeline.
- Enemy defeat tracking.
- Influence gain tracking.
- Zone, mission, power-use, and loot event ingestion.
- Basic analytics charts and top lists.
- Initial build-planner import path for Mids Reborn `.mbd` (JSON-based) exports.

## Project Structure

```text
ParagonLedger/
  electron/
    main.cjs
    preload.cjs
  src/
    main/
      db/
        database.js
      parsers/
        eventParsers.js
      services/
        logIngestService.js
        midsImportService.js
        queryService.js
        settingsService.js
    renderer/
      components/
        AnalyticsCharts.jsx
        BadgeTimeline.jsx
        CharacterList.jsx
        StatsGrid.jsx
      hooks/
        usePolling.js
      services/
        api.js
      styles/
        app.css
      App.jsx
      main.jsx
  data/
    badges.json
    sample-mids-build.mbd
  index.html
  package.json
  vite.config.js
```

## Database Location

ParagonLedger stores data in:

`%APPDATA%/ParagonLedger/heroledger.sqlite` (inside Electron's `app.getPath("userData")`).

On first run after renaming from HeroLedger, existing local DB/settings are copied from `%APPDATA%/HeroLedger` if present.

## How Parsing Works

1. On first run, choose your CoH logs directory in the setup prompt.
2. Start parser.
3. Historical logs are parsed first (recursive scan under the selected account logs path).
4. File watcher continues tailing new lines in near real-time.
5. Parser offsets are stored in `parser_state` to avoid duplicates across restarts.
6. Additional account log folders can be added later and switched from the account picker.

## Event Patterns (MVP)

- `Badge Earned: <Badge Name>`
- `You defeated <Enemy>`
- `You gained <N> influence`
- `Entering zone: <Zone>`
- `Mission Complete: <Mission>`
- `You activated <Power>`
- `You received <Item>`
- Character hints:
  - `Welcome to City of Heroes, <Character>!`
  - `Now playing: <Character>`

Add new patterns in [`eventParsers.js`](./src/main/parsers/eventParsers.js).

## Run Instructions

1. Install dependencies:

```powershell
npm.cmd install
```

2. Start in development mode:

```powershell
npm.cmd run dev
```

3. In the app:
- On first launch, click `Choose Logs Folder`.
- Pick your City of Heroes `logs` directory (example: `C:\Games\COH\accounts\wanderingwampa\Logs`).
- ParagonLedger infers account name from the `accounts\<name>\Logs` path and creates/switches that account.
- Use `Add/Update Account Logs Folder` to add more accounts.
- Click `Start Parser`.
- Open a character and play; events should appear after logs update.

## Build Planner Import (MVP)

- Click `Import Build`.
- Select a `.mbd` file exported by Mids Reborn (or a JSON file with the same structure).
- See [`sample-mids-build.mbd`](./data/sample-mids-build.mbd) for a trimmed Mids-style example payload.
- Imported data is shown in the Build Planner panel.

## Badge Dataset Sync

To refresh the local badge catalog and icon assets from Homecoming Wiki:

```powershell
npm.cmd run sync:badges
```

This updates:
- `data/badges.json`
- `assets/badges/*`

## Notes

- This is an MVP foundation focused on log parsing + character analytics.
- Mids Reborn binary/native format parsing can be added in a follow-up parser module while keeping the current schema and UI.
