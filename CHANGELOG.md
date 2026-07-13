# Changelog

All notable changes to this project are documented here.

## Unreleased

- No unreleased changes yet.

## 1.0.0 - 2026-07-13

### Added

- Moodle Web Services API sync with private iCal fallback/supplement.
- Google Calendar event creation, update, deduplication, and missing-event cleanup.
- Separate Moodle calendar setup helper.
- Hourly trigger setup and trigger removal helpers.
- Feed hash and event content hash checks to reduce unnecessary Calendar API writes.
- Module code/name learning from Moodle API course metadata and iCal text.
- Manual `MODULE_NAMES` and `MODULE_OVERRIDES` support.
- Concise synced event titles such as `CS3501: Attendance`.
- Default reminders and configurable `REMINDER_MINUTES`.
- Optional styled HTML email notifications via `NOTIFY_EMAIL`.
- `sendTestNotification` for previewing the email template.
- Event color rules with `EVENT_COLOR_RULES`.
- Dry-run sync preview.
- Safe setup diagnostics with `validateConfig` and `printSetupSummary`.
- Cleanup/reset helpers for duplicates, primary-calendar migration, sync state, and synced Moodle events.
- Public repo safety tooling, issue templates, pull request template, CI, and secret scan.
- Local Node test coverage for parsing, normalization, module extraction, API pagination, matching, notifications, and cleanup helpers.
