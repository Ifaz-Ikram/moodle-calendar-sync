# Moodle Calendar Sync

Sync Moodle calendar deadlines into Google Calendar using Google Apps Script.

This project is built for a personal/student workflow:

```text
Moodle private iCal URL
        -> Google Apps Script
        -> Google Calendar
```

It does not need a server, database, or paid hosting. Apps Script runs the sync on a schedule.

## Features

- Fetches a private Moodle iCal calendar feed.
- Creates Moodle deadlines in Google Calendar.
- Updates existing Google Calendar events when Moodle changes them.
- Removes synced Google Calendar events that disappear from the Moodle feed.
- Deduplicates repeated Moodle events.
- Learns module names from Moodle event titles/descriptions where possible.
- Supports manual module overrides for generic Moodle titles such as `Attendance`.
- Stores Moodle and Google Calendar configuration in Apps Script Script Properties, not in source code.

## Important Security Note

Your Moodle iCal URL usually contains a private token. Treat it like a password.

Do not commit or share:

- your Moodle iCal URL
- `.clasprc.json`
- `.env` files
- screenshots containing the full Moodle calendar URL

The URL belongs in Apps Script **Script Properties** only.

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

Add:

```text
MOODLE_ICAL_URL     <your private Moodle calendar URL>
MOODLE_CALENDAR_ID  primary
TIMEZONE            Asia/Colombo
```

Use `primary` to sync into your main Google Calendar. To sync into a separate calendar, use that Google Calendar's calendar ID instead.

### 6. Add module names

The script can automatically learn many module names from Moodle entries such as `CS3621 Data Mining (L)` or `In23-S5-MA3024 - Numerical Methods`.

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

Some Moodle iCal events only contain generic titles like `Attendance` and do not expose the course/module. For those, add:

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

This part cannot be fully automated from iCal alone when Moodle omits the course/module from the feed. For full automation of ambiguous items, the project would need Moodle API access or a browser extension that can read the logged-in Moodle page.

### 8. Push code

```bash
npx clasp push --force
```

### 9. Run once manually

In Apps Script, select and run:

```text
syncMoodleCalendar
```

Authorize the requested Google permissions.

### 10. Add the automatic trigger

In Apps Script:

```text
Triggers -> Add Trigger
```

Recommended trigger:

```text
Function: syncMoodleCalendar
Deployment: Head
Event source: Time-driven
Type: Hour timer
Interval: Every hour
```

Hourly syncing is recommended. Running every minute is unnecessary and more likely to hit Apps Script or Google Calendar rate limits.

## Useful Functions

### `syncMoodleCalendar`

Main sync function. Fetches Moodle, updates Google Calendar, removes missing events, and deduplicates synced events.

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
- Google Calendar may take a short time to visually refresh after bulk updates/deletes.
- Very frequent triggers can hit Apps Script or Google Calendar rate limits.

## Recommended Workflow

1. Run `inspectAmbiguousMoodleEvents`.
2. Add missing module mappings to `MODULE_OVERRIDES`.
3. Run `cleanupMoodleCalendarDuplicates`.
4. Run `syncMoodleCalendar`.
5. Add the hourly trigger.

## License

ISC
