# Dental clinic

Everything a dental clinic needs on top of the booking platform. It is a package plugin for AppointIt: install it from **Settings › Plugins**. It stays off until a business switches it on, and keeps its data in its own tables.

## What it adds

- **Medical history** for each patient, stored encrypted, with alerts (allergies, anticoagulants and similar) shown on bookings and the calendar. A reminder asks patients to review their history before a visit.
- **Insurance** policies for each patient. The member ID is stored encrypted.
- **Consent forms** linked to services: a booking shows when the patient still has to sign one.
- **Dental chart** (odontogram) with a history of every change, in FDI or Universal tooth numbering.
- **Procedures**: the clinic's own catalog (no licensed code list), linked to bookable services.
- **Treatment plans** with an estimate, patient acceptance with a signature and a PDF, and one-click booking of every visit as a series.
- **Recall**: patients who are due for their regular check-up, with reminders, snooze and a Recall screen.
- **Starter pack** for a new clinic: menu words, resource types (dentist, hygienist, assistant, operatory, imaging), services, procedures, a recall rule, forms and website pages.

## Switching it on

Install the plugin first (**Settings › Plugins**, then **Browse** or **From Git**). Then pick **Dental clinic** as the business type in the setup wizard, or choose **Use this business type** on the plugin's page. That switches the plugin on for the business and adds the starter pack. Adding it again is safe: what already exists is never changed.

## Settings

Under Settings, Plugins:

- **Tooth numbering**: FDI (11 to 48) or Universal (1 to 32).
- **Medical history review (months)**: how long after a review the history is due again (default 12).

## Data and privacy

- Tables: `plg_dental_*`, with row level security like every other table. They stay when the plugin is removed unless you choose to delete the data.
- Health data (history, chart notes, plan notes, insurance member ID) is encrypted. Reading it is written to the audit log.
- Patient data export and erasure include this plugin's data.

## Access it declares

Customer data, health data, messages, files and settings.

## API

Routes live under `/api/v1/ext/dental/`. Each one names the permission it needs (`health.read`, `health.manage`, `bookings.read`, `bookings.create`, `services.manage`, `settings.manage`, `plugins.manage`, `reports.read`).

## Development

This project builds against the AppointIt checkout next to it: `D:\booking-and-cms` (the folder `../booking-and-cms`). It takes the plugin SDK, the UI kit, the i18n helpers and the `pack` tool from there, until the SDK is published on npm.

1. In `../booking-and-cms`: `pnpm install` (once, and after its dependencies change).
2. Here: `pnpm install`.
3. Check and test:
   - `pnpm typecheck`
   - `pnpm test` (unit)
   - `pnpm test:int` (integration; uses the test database harness of `../booking-and-cms`)

## Releasing

The plugin list ([jaedalzaber/booking-plugins](https://github.com/jaedalzaber/booking-plugins)) installs this plugin from Git, at the tag of a version. A Git install uses this repository's `package/` folder, so the built plugin is committed there.

1. Raise `version` in `plugin.json` and in `src/index.ts` (they must match) and add a line to `CHANGELOG.md`.
2. `pnpm release` builds `package/`. It also writes `release/dental-<version>.zip` and prints its sha256, for a zip upload.
   To sign it: `RELEASE_KEY=<private key PEM> RELEASE_KEY_ID=<key id> pnpm release`.
3. Commit everything, `package/` included. Then tag and push:
   ```
   git tag v<version>
   git push origin main v<version>
   ```
4. In the plugin list's `index.json`, set this plugin's `version` and `download.ref` (`v<version>`). Commit and push it.

Never move a tag that is already pushed. Release a new version instead.

The `v0.2.0` tag is older: it holds only the built files, at its top level. A Git install handles both.

You can also install by hand: **From Git** with this repository's URL and a tag, or **Upload zip** with the zip from step 2.
