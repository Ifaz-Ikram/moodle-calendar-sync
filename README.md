# Moodle Calendar Sync

Sync Moodle calendar deadlines into Google Calendar using Google Apps Script.

This project is built for a personal/student workflow:

```text
Moodle API or private iCal URL
        -> Google Apps Script
        -> Google Calendar
```

It does not need a server, database, or paid hosting. Apps Script runs the sync on a schedule.

## Features

- Fetches Moodle deadlines from the Moodle Web Services API.
- Falls back to a private Moodle iCal calendar feed when API access is unavailable.
- Creates Moodle deadlines in Google Calendar.
- Updates existing Google Calendar events when Moodle changes them.
- Removes synced Google Calendar events that disappear from the Moodle feed.
- Deduplicates repeated Moodle events.
- Learns module names from Moodle event titles/descriptions where possible.
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

## Important Security Note

Your Moodle API token and Moodle iCal URL are private credentials. Treat them like passwords.

Do not commit or share:

- your Moodle API token
- your Moodle iCal URL
- `.clasprc.json`
- `.env` files
- screenshots containing tokens or the full Moodle calendar URL

These values belong in Apps Script **Script Properties** only.

## Quick Start

For a new setup:

```bash
npm install
npx clasp login
npx clasp create --title "Moodle Calendar Sync" --type standalone
npx clasp push --force
npx clasp open-script
```

Then in Apps Script:

1. Enable the advanced `Calendar` service.
2. Add API Script Properties plus `TIMEZONE`.
3. Run `setup`.
4. Run `dryRunSyncMoodleCalendar`.
5. Run `forceSyncMoodleCalendar`.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Log in to clasp

```bash
npx clasp login
```

### 3. Create or clone an Apps Script project

Create a standalone Apps Script project:

```bash
npx clasp create --title "Moodle Calendar Sync" --type standalone
```

Or clone an existing project:

```bash
npx clasp clone <SCRIPT_ID>
```

### 4. Enable the Calendar advanced service

Open the Apps Script editor:

```bash
npx clasp open-script
```

In Apps Script:

```text
Services -> Add a service -> Google Calendar API -> Add
```

Keep the service identifier as:

```text
Calendar
```

### 5. Add Script Properties

In Apps Script:

```text
Project Settings -> Script properties
```

Recommended API setup:

```text
MOODLE_DATA_SOURCE  api
MOODLE_API_BASE     https://online.uom.lk
MOODLE_TOKEN        <your Moodle web service token>
TIMEZONE            Asia/Colombo
```

API mode is recommended because Moodle returns course metadata with events. This lets the script automatically add module codes/names to generic events such as `Attendance`.

Fallback iCal setup:

```text
MOODLE_ICAL_URL     <your private Moodle calendar URL>
TIMEZONE            Asia/Colombo
```

If `MOODLE_DATA_SOURCE` is unset, the script uses API mode when `MOODLE_TOKEN` exists. Otherwise it uses iCal mode.

Keep `MOODLE_ICAL_URL` as a fallback if you want, but do not put any token in source code.

Optional:

```text
MOODLE_CALENDAR_NAME  Moodle Deadlines
MOODLE_CALENDAR_ID    primary
REMINDER_MINUTES      [10080, 2880, 360]
NOTIFY_EMAIL          you@example.com
```

Recommended: leave `MOODLE_CALENDAR_ID` unset at first, then run `setupMoodleCalendar`. It creates or reuses a separate calendar and stores its ID automatically.

Use `primary` only if you intentionally want Moodle events in your main Google Calendar.

`REMINDER_MINUTES` is a JSON array of popup reminders before the deadline. The default is:

```text
10080 = 7 days
2880  = 2 days
360   = 6 hours
```

## Configuration Reference

| Property | Required | Example | Purpose |
| --- | --- | --- | --- |
| `MOODLE_DATA_SOURCE` | No | `api` or `ical` | Selects Moodle data source. If unset, uses API when `MOODLE_TOKEN` exists, otherwise iCal. |
| `MOODLE_ICAL_URL` | For iCal mode | `https://.../calendar/export_execute.php?...` | Private Moodle iCal feed URL. |
| `MOODLE_API_BASE` | For API mode | `https://online.uom.lk` | Moodle site base URL. |
| `MOODLE_TOKEN` | For API mode | `<token>` | Moodle web service token. Never commit this. |
| `TIMEZONE` | Recommended | `Asia/Colombo` | Timezone for Google Calendar event times. |
| `MOODLE_CALENDAR_ID` | No | `primary` or `abc@group.calendar.google.com` | Target Google Calendar. Set automatically by `setupMoodleCalendar`. |
| `MOODLE_CALENDAR_NAME` | No | `Moodle Deadlines` | Calendar name used by `setupMoodleCalendar`. |
| `MODULE_NAMES` | No | `{"CS3501":"Data Science and Engineering Project"}` | Manual module-name map. |
| `MODULE_OVERRIDES` | No | `{"byTitle":{},"byUid":{}}` | Manual mappings for ambiguous Moodle events. |
| `REMINDER_MINUTES` | No | `[10080,2880,360]` | Popup reminders before deadlines. |
| `NOTIFY_EMAIL` | No | `you@example.com` | Sends one email summary when new or changed Moodle deadlines are synced. |

### 6. Add module names

The script can automatically learn many module names from Moodle entries such as `CS3621 Data Mining (L)` or `In23-S5-MA3024 - Numerical Methods`.

API mode usually gives better module details because Moodle returns `course.fullname` and `course.shortname` with each action event.

If you want to provide or override names manually, add a Script Property:

```text
MODULE_NAMES
```

Example value:

```json
{
  "CS3501": "Data Science and Engineering Project",
  "CS3621": "Data Mining",
  "CS3631": "Deep Neural Networks",
  "CS3880": "Engineer and Society",
  "CS3043": "Database Systems",
  "MA2024": "Calculus",
  "MA3024": "Numerical Methods",
  "MA3030": "Operational Research",
  "MN3043": "Business Economics and Financial Accounting"
}
```

### 7. Add module overrides for ambiguous Moodle events

Some Moodle iCal events only contain generic titles like `Attendance` and do not expose the course/module. API mode usually avoids this because Moodle includes course metadata. If an event is still ambiguous, add:

```text
MODULE_OVERRIDES
```

Example value:

```json
{
  "byTitle": {
    "Spot Quiz 02-7th July is due": "MA3024",
    "Practice- Quiz 2 closes": "CS3043",
    "Answer Submission for Additional Questions is due": "MN3043",
    "Self Assessment 01 closes": "MN3043",
    "Self Assessment 02 closes": "MN3043"
  },
  "byUid": {
    "6822664@online.uom.lk": "CS3501"
  }
}
```

Use `byTitle` when every event with that title belongs to the same module. Use `byUid` when only one specific Moodle event should be mapped.

This part cannot be fully automated from iCal alone when Moodle omits the course/module from the feed. If `MOODLE_DATA_SOURCE=api` works for your Moodle site, many `MODULE_OVERRIDES` entries become unnecessary because the API includes course metadata.

### Moodle API token check

If your Moodle mobile app works, your site may allow Moodle Web Services API access.

Get a token locally:

```bash
curl -G 'https://online.uom.lk/login/token.php' \
  --data-urlencode 'service=moodle_mobile_app' \
  --data-urlencode 'username=YOUR_USERNAME' \
  --data-urlencode 'password=YOUR_PASSWORD'
```

Do not paste the returned token into chat, screenshots, or Git.

Test the token:

```bash
curl -G 'https://online.uom.lk/webservice/rest/server.php' \
  --data-urlencode 'wstoken=YOUR_TOKEN' \
  --data-urlencode 'wsfunction=core_webservice_get_site_info' \
  --data-urlencode 'moodlewsrestformat=json'
```

Test action events:

```bash
curl -G 'https://online.uom.lk/webservice/rest/server.php' \
  --data-urlencode 'wstoken=YOUR_TOKEN' \
  --data-urlencode 'wsfunction=core_calendar_get_action_events_by_timesort' \
  --data-urlencode 'moodlewsrestformat=json'
```

### 8. Push code

```bash
npx clasp push --force
```

### 9. Run tests locally

```bash
npm test
```

### 10. Run first-time setup

In Apps Script, select and run:

```text
setup
```

This creates or reuses the `Moodle Deadlines` Google Calendar, validates Script Properties, checks Moodle and Google Calendar access, and installs the hourly trigger.

### 11. Preview changes

In Apps Script, select and run:

```text
dryRunSyncMoodleCalendar
```

This logs what would be created, updated, deleted, or skipped without changing Google Calendar.

### 12. Run once manually

In Apps Script, select and run:

```text
forceSyncMoodleCalendar
```

Authorize the requested Google permissions.

`setup` already installs the recommended hourly trigger automatically.

Manual equivalent:

```text
Function: syncMoodleCalendar
Deployment: Head
Event source: Time-driven
Type: Hour timer
Interval: Every hour
```

Hourly syncing is recommended. Running every minute is unnecessary and more likely to hit Apps Script or Google Calendar rate limits.

## Migrating From `primary` To `Moodle Deadlines`

If you originally synced into your main calendar:

1. Run `setupMoodleCalendar`.
2. Run `forceSyncMoodleCalendar`.
3. Confirm events appear in the new `Moodle Deadlines` calendar.
4. Run `cleanupPrimaryMoodleEvents`.

This removes synced Moodle events from `primary` while keeping your personal calendar events alone.

## Useful Functions

### `setup`

First-run helper. Creates or reuses the Moodle calendar, validates configuration, installs the hourly trigger, and logs the next steps.

It does not create Moodle events. Run `dryRunSyncMoodleCalendar`, then `forceSyncMoodleCalendar`.

### `syncMoodleCalendar`

Main sync function. Fetches Moodle, updates Google Calendar, removes missing events, and deduplicates synced events.

If the Moodle feed and module configuration are unchanged, it skips Calendar API reads/writes to reduce quota usage.

When the feed has changed, each event is still compared with a stored content hash so unchanged events are not rewritten.

Synced events use popup reminders from `REMINDER_MINUTES`, or `[10080, 2880, 360]` by default.

If `NOTIFY_EMAIL` is set, the script sends one email summary when a run creates new deadlines or updates existing ones. Dry runs, unchanged events, duplicate cleanup, and deleted old events do not send notifications.

At the end of each run, the execution log shows a sync report with source, calendar ID, created/updated/deleted counts, skipped/unchanged counts, missing-module count, and trigger status.

### `forceSyncMoodleCalendar`

Runs the full sync even when the feed hash has not changed.

Use this after changing Script Properties such as `MODULE_NAMES` or `MODULE_OVERRIDES`.

### `dryRunSyncMoodleCalendar`

Previews creates, updates, duplicate deletes, and missing-event removals without changing Google Calendar.

### `setupMoodleCalendar`

Creates or reuses a Google Calendar named `Moodle Deadlines` and stores its calendar ID in `MOODLE_CALENDAR_ID`.

### `validateConfig`

Checks Script Properties, Moodle data-source access, Google Calendar access, reminder configuration, and trigger presence.

When validation fails, the error message points to the likely fix, such as missing `MOODLE_TOKEN`, invalid JSON in `MODULE_NAMES`, a broken Moodle iCal URL, or the Google Calendar advanced service not being enabled.

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

Run this manually if your calendar already contains duplicates.

### `inspectAmbiguousMoodleEvents`

Logs Moodle events where the module code cannot be inferred.

Use this to find UIDs for `MODULE_OVERRIDES`.

### `inspectLearnedModuleNames`

Logs module names that the script can infer automatically from the Moodle feed.

## Known Limitations

- Moodle iCal feeds may omit course/module details for generic events.
- If Moodle does not expose module details in iCal, this script cannot infer them without `MODULE_OVERRIDES`.
- Moodle API mode requires a valid Moodle web service token.
- Google Calendar may take a short time to visually refresh after bulk updates/deletes.
- Very frequent triggers can hit Apps Script or Google Calendar rate limits.

## Troubleshooting

### `Rate Limit Exceeded`

Wait a few minutes and run again. The script uses retries, feed hashing, and content hashing to reduce writes, but large first syncs can still hit temporary limits.

### Events are duplicated

Run:

```text
cleanupMoodleCalendarDuplicates
forceSyncMoodleCalendar
```

Then refresh Google Calendar or switch months and back.

### Events are missing module names

Run:

```text
inspectAmbiguousMoodleEvents
inspectLearnedModuleNames
```

If Moodle does not expose the module in iCal, add the event to `MODULE_OVERRIDES`.

### I changed Script Properties but nothing updated

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

## Recommended Workflow

1. Configure API mode with `MOODLE_TOKEN`.
2. Run `setup`.
3. Run `dryRunSyncMoodleCalendar`.
4. Run `forceSyncMoodleCalendar`.
5. Run `inspectAmbiguousMoodleEvents` only if some events still miss module details.

## License

ISC
