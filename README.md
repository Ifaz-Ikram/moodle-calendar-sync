# Moodle Calendar Sync

[![CI](https://github.com/Ifaz-Ikram/moodle-calendar-sync/actions/workflows/ci.yml/badge.svg)](https://github.com/Ifaz-Ikram/moodle-calendar-sync/actions/workflows/ci.yml)

Sync Moodle deadlines into Google Calendar using Google Apps Script.

```text
Moodle API or private iCal URL
        -> Google Apps Script
        -> Google Calendar
```

This does not need a server, database, or paid hosting. Apps Script runs the sync on a schedule.

## What You Need

- A Google account.
- Access to `https://online.uom.lk`.
- Node.js and npm installed locally.
- Moodle credentials for UoM.

## First-Time Setup For UoM Students

Follow these steps in order.

### 1. Install dependencies

```bash
npm install
```

### 2. Log in to Google Apps Script from your terminal

```bash
npx clasp login
```

### 3. Create an Apps Script project

```bash
npx clasp create --title "Moodle Calendar Sync" --type standalone
```

Then push this project to Apps Script:

```bash
npx clasp push --force
npx clasp open-script
```

### 4. Enable Google Calendar API in Apps Script

In the Apps Script editor:

```text
Services -> Add a service -> Google Calendar API -> Add
```

Keep the service identifier as:

```text
Calendar
```

### 5. Get your UoM Moodle API token

Run this locally. Replace the username and password with your Moodle login details:

```bash
curl -G 'https://online.uom.lk/login/token.php' \
  --data-urlencode 'service=moodle_mobile_app' \
  --data-urlencode 'username=YOUR_USERNAME' \
  --data-urlencode 'password=YOUR_PASSWORD'
```

The response contains a token. Copy only the token value.

Do not paste the token into GitHub, chat, screenshots, or source code.

### 6. Get your UoM Moodle iCal URL

The iCal URL is optional in API mode, but recommended. It helps include Moodle calendar entries that the API may not return, such as some attendance events.

1. Log in to `https://online.uom.lk`.
2. Open `https://online.uom.lk/calendar/export.php`.
3. Choose the events you want to export. Use all events if you want assignments, quizzes, attendance, and other Moodle deadlines.
4. Choose the time period. Recent and next 60 days is usually enough, but all events is also fine if Moodle offers it.
5. Click the button to get the calendar URL.
6. Copy the generated URL. It usually points to `/calendar/export_execute.php` and includes private token parameters.

Treat this URL like a password. Anyone with the full link can read the exported Moodle calendar feed.

### 7. Add Script Properties

In Apps Script:

```text
Project Settings -> Script properties
```

Add these properties:

```text
MOODLE_DATA_SOURCE  api
MOODLE_API_BASE     https://online.uom.lk
MOODLE_TOKEN        <your Moodle web service token>
MOODLE_ICAL_URL     <your private Moodle calendar URL>
TIMEZONE            Asia/Colombo
```

`MOODLE_ICAL_URL` can be skipped if you only want API mode, but keeping it is recommended.

### 8. Run first setup

In Apps Script, run:

```text
setup
```

Approve the Google permissions when prompted.

This creates or reuses a Google Calendar named `Moodle Deadlines`, validates your settings, and installs the hourly sync trigger.

### 9. Preview the sync

Run:

```text
dryRunSyncMoodleCalendar
```

This shows what would be created, updated, deleted, or skipped without changing Google Calendar.

### 10. Sync once manually

Run:

```text
forceSyncMoodleCalendar
```

After this, check the `Moodle Deadlines` calendar in Google Calendar.

## Normal Use

After setup, the hourly trigger runs automatically. You usually do not need to run anything manually.

Use these functions when needed:

| Function | When to use it |
| --- | --- |
| `forceSyncMoodleCalendar` | Run a sync immediately. Use this after changing Script Properties. |
| `dryRunSyncMoodleCalendar` | Preview changes without editing Google Calendar. |
| `validateConfig` | Check whether Script Properties, Moodle access, and Calendar access are valid. |
| `printSetupSummary` | Print setup details without exposing tokens or private URLs. |
| `inspectAmbiguousMoodleEvents` | Find Moodle events that are missing module codes. |
| `cleanupMoodleCalendarDuplicates` | Remove duplicate synced events. |

## Security

Your Moodle API token and Moodle iCal URL are private credentials. Treat them like passwords.

Do not commit or share:

- your Moodle API token
- your Moodle iCal URL
- `.clasprc.json`
- `.env` files
- screenshots containing tokens or the full Moodle calendar URL

These values belong in Apps Script **Script Properties** only.

## Configuration Reference

| Property | Required | Example | Purpose |
| --- | --- | --- | --- |
| `MOODLE_DATA_SOURCE` | No | `api` or `ical` | Selects Moodle data source. If unset, uses API when `MOODLE_TOKEN` exists, otherwise iCal. |
| `MOODLE_ICAL_URL` | For iCal mode | `https://.../calendar/export_execute.php?...` | Private Moodle iCal feed URL. Recommended even in API mode. |
| `MOODLE_API_BASE` | For API mode | `https://online.uom.lk` | Moodle site base URL. |
| `MOODLE_TOKEN` | For API mode | `<token>` | Moodle web service token. Never commit this. |
| `TIMEZONE` | Recommended | `Asia/Colombo` | Timezone for Google Calendar event times. |
| `MOODLE_CALENDAR_ID` | No | `primary` or `abc@group.calendar.google.com` | Target Google Calendar. Set automatically by `setupMoodleCalendar`. |
| `MOODLE_CALENDAR_NAME` | No | `Moodle Deadlines` | Calendar name used by `setupMoodleCalendar`. |
| `MODULE_NAMES` | No | `{"CS3501":"Data Science and Engineering Project"}` | Manual module-name map. |
| `MODULE_OVERRIDES` | No | `{"byTitle":{},"byUid":{}}` | Manual mappings for ambiguous Moodle events. |
| `REMINDER_MINUTES` | No | `[10080,2880,360]` | Popup reminders before deadlines. |
| `NOTIFY_EMAIL` | No | `you@example.com` | Sends one email summary when new or changed Moodle deadlines are synced. |
| `EVENT_COLOR_RULES` | No | `{"byKeyword":{"quiz":"5"}}` | Google Calendar event colors by keyword, module, or Moodle event type. |

For a copyable example, see:

```text
script-properties.example.json
```

Do not put real secrets in that file.

## Optional Settings

### Reminders

By default, synced events use these popup reminders:

```text
10080 = 7 days
2880  = 2 days
360   = 6 hours
```

To change them, add this Script Property:

```text
REMINDER_MINUTES  [10080,2880,360]
```

### Notification emails

To receive one email summary when new or changed deadlines are synced, add:

```text
NOTIFY_EMAIL  you@example.com
```

Run this to send a sample email:

```text
sendTestNotification
```

### Event colors

The script assigns default Google Calendar colors for common Moodle event types:

```text
attendance, quiz, assignment, submission, assessment, lecture, lab, practical, exam
```

To customize colors, add:

```text
EVENT_COLOR_RULES
```

Example:

```json
{
  "byModule": {
    "CS3501": "9",
    "MA3024": "5"
  },
  "byKeyword": {
    "attendance": "7",
    "quiz": "5",
    "submission": "11",
    "exam": "4"
  },
  "byEventType": {
    "due": "11"
  }
}
```

Google Calendar color IDs are numbers from `"1"` to `"11"`. Module rules win first, then Moodle event type, then keyword rules.

## Module Names And Ambiguous Events

API mode usually gives the best module details because Moodle returns course metadata with each action event.

Synced Google Calendar titles use the module code as a short prefix when the original Moodle title does not already include it:

```text
Attendance -> CS3501: Attendance
Self Assessment 01 closes -> MN3043: Self Assessment 01 closes
```

The full module name is stored in the event description.

If an event still misses its module code, run:

```text
inspectAmbiguousMoodleEvents
```

Then add a `MODULE_OVERRIDES` Script Property only for the ambiguous event.

Example:

```json
{
  "byTitle": {
    "Spot Quiz 02-7th July is due": "MA3024",
    "Practice- Quiz 2 closes": "CS3043"
  },
  "byUid": {
    "6822664@online.uom.lk": "CS3501"
  }
}
```

Use `byTitle` only when every event with that title belongs to the same module. Prefer `byUid` for one specific Moodle event.

Priority order:

1. `byUid` for one specific Moodle event
2. Moodle API `course.shortname` / `course.fullname`
3. `byTitle` for iCal-only ambiguous events
4. Automatic text detection

## Advanced Setup

### Use iCal only

If you cannot get a Moodle API token, use iCal mode:

```text
MOODLE_DATA_SOURCE  ical
MOODLE_ICAL_URL     <your private Moodle calendar URL>
TIMEZONE            Asia/Colombo
```

### Clone an existing Apps Script project

If you already have an Apps Script project:

```bash
npx clasp clone <SCRIPT_ID>
npx clasp push --force
```

### Run local tests

```bash
npm test
```

Run the same checks used by GitHub Actions:

```bash
npm run ci
```

This runs a lightweight secret scan and the test suite.

## Useful Functions

### `setup`

First-run helper. Creates or reuses the Moodle calendar, validates configuration, installs the hourly trigger, and logs the next steps.

It does not create Moodle events. Run `dryRunSyncMoodleCalendar`, then `forceSyncMoodleCalendar`.

### `syncMoodleCalendar`

Main sync function. Fetches Moodle, updates Google Calendar, removes missing events, and deduplicates synced events.

If the Moodle feed and module configuration are unchanged, it skips Calendar API reads and writes to reduce quota usage.

### `forceSyncMoodleCalendar`

Runs the full sync even when the feed hash has not changed.

Use this after changing Script Properties such as `MODULE_NAMES` or `MODULE_OVERRIDES`.

### `dryRunSyncMoodleCalendar`

Previews creates, updates, duplicate deletes, and missing-event removals without changing Google Calendar.

### `sendTestNotification`

Sends a sample styled email to `NOTIFY_EMAIL`.

### `printSetupSummary`

Logs a safe setup summary without printing Moodle tokens, private iCal URLs, or passwords.

### `setupMoodleCalendar`

Creates or reuses a Google Calendar named `Moodle Deadlines` and stores its calendar ID in `MOODLE_CALENDAR_ID`.

### `validateConfig`

Checks Script Properties, Moodle data-source access, Google Calendar access, reminder configuration, and trigger presence.

### `cleanupPrimaryMoodleEvents`

Removes synced Moodle events from your primary Google Calendar.

Use this after switching from `primary` to a separate `Moodle Deadlines` calendar:

```text
setupMoodleCalendar
forceSyncMoodleCalendar
cleanupPrimaryMoodleEvents
```

### `setupHourlyTrigger`

Removes existing `syncMoodleCalendar` triggers and installs one hourly trigger.

### `removeSyncTriggers`

Deletes installed triggers for `syncMoodleCalendar`.

### `listProjectTriggers`

Logs installed project triggers.

### `cleanupMoodleCalendarDuplicates`

Deletes duplicate Google Calendar events created by previous sync runs.

### `resetSyncState`

Clears the cached feed hash. The next normal sync will re-check Moodle and Google Calendar even if Moodle appears unchanged.

### `dryRunDeleteAllSyncedMoodleEvents`

Logs synced Moodle events that would be deleted from the configured Moodle calendar.

### `deleteAllSyncedMoodleEvents`

Deletes all synced Moodle events from the configured Moodle calendar and clears the cached sync state.

Use this when testing or when you want to rebuild the synced calendar from scratch:

```text
dryRunDeleteAllSyncedMoodleEvents
deleteAllSyncedMoodleEvents
forceSyncMoodleCalendar
```

### `inspectAmbiguousMoodleEvents`

Logs Moodle events where the module code cannot be inferred from the merged feed.

### `inspectLearnedModuleNames`

Logs module names that the script can infer automatically from the Moodle feed.

## Troubleshooting

| Problem | Likely cause | Fix |
| --- | --- | --- |
| No module code/name | Moodle did not expose course metadata for that event | Run `inspectAmbiguousMoodleEvents`, then add `MODULE_OVERRIDES`. |
| No notification email | No events were created/updated, or `NOTIFY_EMAIL` is not set | Check the sync report. Emails are only sent when `Created` or `Updated` is greater than 0. |
| Duplicate events | Older sync runs created repeated Google Calendar events | Run `cleanupMoodleCalendarDuplicates`, then `forceSyncMoodleCalendar`. |
| Token/API error | Moodle token expired, was revoked, or was copied incorrectly | Regenerate the Moodle token and update `MOODLE_TOKEN`. |
| Calendar API error | Advanced Calendar service is not enabled or calendar ID is wrong | Enable `Services -> Google Calendar API`, then run `setupMoodleCalendar`. |
| Changes do not appear | Feed/config hash skipped a normal sync | Run `forceSyncMoodleCalendar`. |
| Events still look old | Google Calendar UI cache or existing event content has not been rewritten | Run `forceSyncMoodleCalendar`, then refresh Calendar or switch weeks/months. |

### Rate limit exceeded

Wait a few minutes and run again. Hourly syncing is recommended. Running every minute is unnecessary and more likely to hit Apps Script or Google Calendar rate limits.

### Events are duplicated

Run:

```text
cleanupMoodleCalendarDuplicates
forceSyncMoodleCalendar
```

Then refresh Google Calendar or switch months and back.

### Rebuild the Moodle calendar from scratch

Run:

```text
dryRunDeleteAllSyncedMoodleEvents
deleteAllSyncedMoodleEvents
forceSyncMoodleCalendar
```

This only deletes events created by this script in the configured Moodle calendar.

### Script Properties changed but nothing updated

Run:

```text
forceSyncMoodleCalendar
```

Normal sync may skip work when the feed/config hash appears unchanged.

### `Unknown command "clasp open"`

This project uses clasp 3.x. Use:

```bash
npx clasp open-script
```

### Tests are being pushed to Apps Script

The repo includes `.claspignore` so only these files should be pushed:

```text
Code.js
appsscript.json
```

Check with:

```bash
npx clasp status
```

## Updating Safely

When pulling a new version of this repo:

```bash
git pull
npm install
npm run ci
npx clasp status
npx clasp push --force
```

Then in Apps Script:

```text
validateConfig
dryRunSyncMoodleCalendar
forceSyncMoodleCalendar
```

If the update changes title formatting, colors, reminders, or module rules, use `forceSyncMoodleCalendar` so existing Google Calendar events are rewritten.

## Features

- Fetches Moodle deadlines from the Moodle Web Services API.
- Falls back to a private Moodle iCal calendar feed when API access is unavailable.
- Creates Moodle deadlines in Google Calendar.
- Updates existing Google Calendar events when Moodle changes them.
- Removes synced Google Calendar events that disappear from the Moodle feed.
- Deduplicates repeated Moodle events.
- Learns module names from Moodle event titles/descriptions where possible.
- Adds concise module prefixes to synced titles, such as `CS3501: Attendance`.
- Skips Calendar API work when the Moodle feed and module configuration have not changed.
- Skips updating individual Google Calendar events when their content has not changed.
- Can create and use a separate Google Calendar for Moodle deadlines.
- Can install/remove the hourly Apps Script trigger from helper functions.
- Adds default popup reminders to Moodle deadlines.
- Includes a configuration validator for setup troubleshooting.
- Provides a dry-run sync preview.
- Can use Moodle Web Services API for better course/module metadata.
- Supports manual module overrides for generic Moodle titles such as `Attendance`.
- Stores Moodle and Google Calendar configuration in Apps Script Script Properties, not in source code.

## Known Limitations

- Moodle iCal feeds may omit course/module details for generic events.
- If Moodle does not expose module details in iCal, this script cannot infer them without `MODULE_OVERRIDES`.
- Moodle API mode requires a valid Moodle web service token.
- Google Calendar may take a short time to visually refresh after bulk updates/deletes.
- Very frequent triggers can hit Apps Script or Google Calendar rate limits.

## Reporting Issues

Use the GitHub issue templates for setup problems, wrong module names, duplicate events, Moodle API/token problems, and feature requests.

Never include Moodle tokens, private iCal URLs, passwords, or screenshots containing secrets in a public issue.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

ISC
