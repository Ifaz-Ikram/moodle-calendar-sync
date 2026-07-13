# Contributing

Thanks for improving Moodle Calendar Sync.

## Safety first

Never commit or paste:

- Moodle API tokens
- Moodle private iCal URLs
- passwords
- `.clasp.json` contents
- screenshots containing secrets

If a token is exposed, revoke/regenerate it before continuing.

## Local setup

```bash
npm install
npm run ci
```

Use `script-properties.example.json` as a reference only. Real values belong in Apps Script **Project Settings -> Script Properties**.

## Apps Script workflow

Before pushing code to Apps Script:

```bash
npm run ci
npx clasp status
```

Only these files should be pushed by clasp:

```text
Code.js
appsscript.json
```

Then push:

```bash
npx clasp push --force
```

## Testing changes

Use focused tests for parser, matching, module extraction, and notification formatting changes.

Run:

```bash
npm run ci
```

For Apps Script behavior, test with safe helper functions first:

```text
validateConfig
printSetupSummary
dryRunSyncMoodleCalendar
sendTestNotification
```

Use `forceSyncMoodleCalendar` only when you want to rewrite real Google Calendar events.

## Pull requests

Before opening a PR:

- run `npm run ci`
- remove secrets from logs/screenshots
- update README or CHANGELOG if behavior changed
- mention any Apps Script function you manually tested
