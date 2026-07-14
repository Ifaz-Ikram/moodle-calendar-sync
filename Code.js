const PROP_MOODLE_ICAL_URL = 'MOODLE_ICAL_URL';
const PROP_MOODLE_CALENDAR_ID = 'MOODLE_CALENDAR_ID';
const PROP_MOODLE_CALENDAR_NAME = 'MOODLE_CALENDAR_NAME';
const PROP_MOODLE_API_BASE = 'MOODLE_API_BASE';
const PROP_MOODLE_TOKEN = 'MOODLE_TOKEN';
const PROP_MOODLE_DATA_SOURCE = 'MOODLE_DATA_SOURCE';
const PROP_TIMEZONE = 'TIMEZONE';
const PROP_MODULE_OVERRIDES = 'MODULE_OVERRIDES';
const PROP_MODULE_NAMES = 'MODULE_NAMES';
const PROP_REMINDER_MINUTES = 'REMINDER_MINUTES';
const PROP_LAST_SYNC_HASH = 'LAST_SYNC_HASH';
const PROP_NOTIFY_EMAIL = 'NOTIFY_EMAIL';
const PROP_EVENT_COLOR_RULES = 'EVENT_COLOR_RULES';
const SYNC_TAG = 'MOODLE_SYNC_UID';
const SOURCE_NAME = 'moodle-calendar-sync';
const DEFAULT_MOODLE_CALENDAR_NAME = 'Moodle Deadlines';
const DEFAULT_MOODLE_API_BASE = 'https://online.uom.lk';
const DATA_SOURCE_API = 'api';
const DATA_SOURCE_ICAL = 'ical';
const DEFAULT_REMINDER_MINUTES = [10080, 2880, 1440, 360, 60];
const DEFAULT_EVENT_COLOR_RULES = {
  byKeyword: {
    attendance: '7',
    quiz: '5',
    assignment: '11',
    submission: '11',
    assessment: '6',
    lecture: '9',
    lab: '10',
    practical: '10',
    exam: '4',
  },
  byModule: {},
  byEventType: {},
};
const SYNC_TRIGGER_HANDLER = 'syncMoodleCalendar';
const SYNC_START_DATE = '2026-07-01';
const SYNC_END_DATE = '2028-06-30';
const MOODLE_API_PAGE_SIZE = 50;
const MOODLE_API_MAX_PAGES = 200;

function syncMoodleCalendar() {
  syncMoodleCalendarInternal({ force: false, dryRun: false });
}

function forceSyncMoodleCalendar() {
  syncMoodleCalendarInternal({ force: true, dryRun: false });
}

function dryRunSyncMoodleCalendar() {
  syncMoodleCalendarInternal({ force: true, dryRun: true });
}

function setup() {
  Logger.log('Starting Moodle Calendar Sync setup...');
  setupMoodleCalendar();
  validateConfig();
  setupHourlyTrigger();
  Logger.log('Setup complete.');
  Logger.log('Next: run dryRunSyncMoodleCalendar to preview changes.');
  Logger.log('Then run forceSyncMoodleCalendar to create/update Google Calendar events.');
}

function sendTestNotification() {
  const props = PropertiesService.getScriptProperties();
  const email = props.getProperty(PROP_NOTIFY_EMAIL);
  validateRequiredProperty(
    PROP_NOTIFY_EMAIL,
    email,
    'Add your email address in Apps Script -> Project Settings -> Script Properties.'
  );

  sendSyncNotifications(email, getSampleNotificationItems());
  Logger.log('Test notification sent to %s.', email);
}

function setupMoodleCalendar() {
  const props = PropertiesService.getScriptProperties();
  const timezone = props.getProperty(PROP_TIMEZONE) || Session.getScriptTimeZone();
  const calendarName = props.getProperty(PROP_MOODLE_CALENDAR_NAME) || DEFAULT_MOODLE_CALENDAR_NAME;
  const calendar = findOrCreateCalendar(calendarName, timezone);

  props.setProperty(PROP_MOODLE_CALENDAR_ID, calendar.id);
  Logger.log('Moodle calendar ready: %s (%s)', calendar.summary, calendar.id);
}

function setupHourlyTrigger() {
  removeSyncTriggers();
  ScriptApp.newTrigger(SYNC_TRIGGER_HANDLER)
    .timeBased()
    .everyHours(1)
    .create();
  Logger.log('Hourly sync trigger installed for %s.', SYNC_TRIGGER_HANDLER);
}

function validateConfig() {
  const props = PropertiesService.getScriptProperties();
  const icalUrl = props.getProperty(PROP_MOODLE_ICAL_URL);
  const dataSource = getMoodleDataSource(props);
  const calendarId = props.getProperty(PROP_MOODLE_CALENDAR_ID) || 'primary';
  const timezone = props.getProperty(PROP_TIMEZONE) || Session.getScriptTimeZone();

  Logger.log('Validating Moodle Calendar Sync configuration...');
  if (dataSource === DATA_SOURCE_API) {
    validateRequiredProperty(
      PROP_MOODLE_TOKEN,
      props.getProperty(PROP_MOODLE_TOKEN),
      'Add your Moodle web service token in Apps Script -> Project Settings -> Script Properties.'
    );
  } else {
    validateRequiredProperty(
      PROP_MOODLE_ICAL_URL,
      icalUrl,
      'Add your private Moodle calendar export URL, or switch to API mode with MOODLE_DATA_SOURCE=api.'
    );
  }
  validateJsonProperty(PROP_MODULE_NAMES, props.getProperty(PROP_MODULE_NAMES), 'object');
  validateJsonProperty(PROP_MODULE_OVERRIDES, props.getProperty(PROP_MODULE_OVERRIDES), 'object');
  validateJsonProperty(PROP_REMINDER_MINUTES, props.getProperty(PROP_REMINDER_MINUTES), 'array');
  validateJsonProperty(PROP_EVENT_COLOR_RULES, props.getProperty(PROP_EVENT_COLOR_RULES), 'object');

  let source;
  try {
    source = loadMoodleEvents(props);
  } catch (error) {
    throw new Error(formatMoodleValidationError(dataSource, error));
  }
  Logger.log('Moodle %s fetch OK. Parsed events: %s', source.source, source.rawEvents.length);
  if (!source.rawEvents.length) {
    Logger.log('Warning: Moodle fetch worked, but returned 0 events in the sync window.');
  }

  let calendar;
  try {
    calendar = Calendar.Calendars.get(calendarId);
  } catch (error) {
    throw new Error(formatCalendarValidationError(calendarId, error));
  }
  Logger.log('Google Calendar access OK: %s (%s)', calendar.summary, calendar.id);
  Logger.log('Timezone: %s', timezone);
  Logger.log('Reminder minutes: %s', JSON.stringify(getReminderMinutes(props)));
  Logger.log('Event color rules: %s', JSON.stringify(getEventColorRules(props)));
  Logger.log('Moodle data source: %s', dataSource);
  Logger.log('Sync trigger installed: %s', hasSyncTrigger() ? 'yes' : 'no');
  Logger.log('Configuration validation complete.');
}

function printSetupSummary() {
  const props = PropertiesService.getScriptProperties();
  const calendarId = props.getProperty(PROP_MOODLE_CALENDAR_ID) || 'primary';
  const summary = formatSetupSummary({
    dataSource: getMoodleDataSource(props),
    apiBase: getMoodleApiBase(props),
    hasMoodleToken: Boolean(props.getProperty(PROP_MOODLE_TOKEN)),
    hasIcalUrl: Boolean(props.getProperty(PROP_MOODLE_ICAL_URL)),
    timezone: props.getProperty(PROP_TIMEZONE) || Session.getScriptTimeZone(),
    calendarId: calendarId,
    calendarName: props.getProperty(PROP_MOODLE_CALENDAR_NAME) || DEFAULT_MOODLE_CALENDAR_NAME,
    notifyEmailSet: Boolean(props.getProperty(PROP_NOTIFY_EMAIL)),
    moduleNamesSet: Boolean(props.getProperty(PROP_MODULE_NAMES)),
    moduleOverridesSet: Boolean(props.getProperty(PROP_MODULE_OVERRIDES)),
    eventColorRulesSet: Boolean(props.getProperty(PROP_EVENT_COLOR_RULES)),
    reminderMinutes: getReminderMinutes(props),
    triggerInstalled: hasSyncTrigger(),
  });

  Logger.log(summary);
}

function formatSetupSummary(summary) {
  return [
    'Moodle Calendar Sync setup summary',
    'Data source: ' + summary.dataSource,
    'Moodle API base: ' + summary.apiBase,
    'Moodle token: ' + (summary.hasMoodleToken ? 'set' : 'missing'),
    'Moodle iCal URL: ' + (summary.hasIcalUrl ? 'set' : 'missing'),
    'Timezone: ' + summary.timezone,
    'Google Calendar ID: ' + summary.calendarId,
    'Google Calendar name: ' + summary.calendarName,
    'Notification email: ' + (summary.notifyEmailSet ? 'set' : 'not set'),
    'Module names: ' + (summary.moduleNamesSet ? 'set' : 'not set'),
    'Module overrides: ' + (summary.moduleOverridesSet ? 'set' : 'not set'),
    'Event color rules: ' + (summary.eventColorRulesSet ? 'set' : 'default'),
    'Reminder minutes: ' + JSON.stringify(summary.reminderMinutes || []),
    'Hourly trigger installed: ' + (summary.triggerInstalled ? 'yes' : 'no'),
  ].join('\n');
}

function cleanupPrimaryMoodleEvents() {
  const props = PropertiesService.getScriptProperties();
  const icalUrl = props.getProperty(PROP_MOODLE_ICAL_URL);
  const timezone = props.getProperty(PROP_TIMEZONE) || Session.getScriptTimeZone();
  const moduleOverrides = getModuleOverrides(props);
  const moduleNames = getModuleNames(props);

  if (!icalUrl) {
    throw new Error('Missing script property: ' + PROP_MOODLE_ICAL_URL);
  }

  const rawMoodleEvents = parseIcsEvents(fetchIcs(icalUrl));
  const moodleEvents = dedupeMoodleEvents(rawMoodleEvents);
  const learnedModuleNames = learnModuleNames(rawMoodleEvents);
  Object.keys(learnedModuleNames).forEach(function(code) {
    if (!moduleNames[code]) {
      moduleNames[code] = learnedModuleNames[code];
    }
  });

  const moodleVisibleKeys = getMoodleVisibleKeys(moodleEvents, moduleOverrides, moduleNames, timezone);
  const window = getSyncWindowBounds();
  const existing = findExistingMoodleEvents('primary', window.start, window.end, moodleVisibleKeys, timezone);
  const deleted = removeExistingMoodleEvents('primary', existing.events);

  Logger.log('Primary calendar Moodle cleanup complete. Deleted: %s', deleted);
}

function removeSyncTriggers() {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === SYNC_TRIGGER_HANDLER) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  Logger.log('Removed %s sync trigger(s).', removed);
}

function listProjectTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  if (!triggers.length) {
    Logger.log('No project triggers installed.');
    return;
  }

  triggers.forEach(function(trigger) {
    Logger.log(
      'Trigger | handler=%s | source=%s | event=%s | id=%s',
      trigger.getHandlerFunction(),
      trigger.getTriggerSource(),
      trigger.getEventType(),
      trigger.getUniqueId()
    );
  });
}

function hasSyncTrigger() {
  return ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === SYNC_TRIGGER_HANDLER;
  });
}

function validateRequiredProperty(name, value, hint) {
  if (!value) {
    throw new Error('Missing required Script Property: ' + name + (hint ? '\n' + hint : ''));
  }
}

function validateJsonProperty(name, raw, expectedType) {
  if (!raw) {
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      'Invalid JSON in Script Property ' + name + ': ' + error.message +
      '\nFix the value in Apps Script -> Project Settings -> Script Properties.'
    );
  }

  if (expectedType === 'array' && !Array.isArray(parsed)) {
    throw new Error('Script Property ' + name + ' must be a JSON array. Example: [10080,2880,1440,360,60]');
  }

  if (expectedType === 'object' && (Array.isArray(parsed) || parsed === null || typeof parsed !== 'object')) {
    throw new Error('Script Property ' + name + ' must be a JSON object. Example: {"CS3501":"Data Science and Engineering Project"}');
  }
}

function formatMoodleValidationError(dataSource, error) {
  const message = error && error.message ? error.message : String(error);
  if (dataSource === DATA_SOURCE_API) {
    return [
      'Moodle API validation failed.',
      'Check MOODLE_API_BASE and MOODLE_TOKEN. If you regenerated the token, update the Script Property.',
      'Original error: ' + message,
    ].join('\n');
  }

  return [
    'Moodle iCal validation failed.',
    'Check MOODLE_ICAL_URL. It must be the private export URL, not the normal Moodle calendar page.',
    'Original error: ' + message,
  ].join('\n');
}

function formatCalendarValidationError(calendarId, error) {
  const message = error && error.message ? error.message : String(error);
  return [
    'Google Calendar validation failed for calendar ID: ' + calendarId,
    'Enable Services -> Google Calendar API in the Apps Script editor, then run setupMoodleCalendar if MOODLE_CALENDAR_ID is missing or wrong.',
    'Original error: ' + message,
  ].join('\n');
}

function syncMoodleCalendarInternal(options) {
  const force = Boolean(options && options.force);
  const dryRun = Boolean(options && options.dryRun);
  const props = PropertiesService.getScriptProperties();
  const icalUrl = props.getProperty(PROP_MOODLE_ICAL_URL);
  const calendarId = props.getProperty(PROP_MOODLE_CALENDAR_ID) || 'primary';
  const timezone = props.getProperty(PROP_TIMEZONE) || Session.getScriptTimeZone();
  const moduleOverrides = getModuleOverrides(props);
  const moduleNames = getModuleNames(props);
  const reminderMinutes = getReminderMinutes(props);
  const notifyEmail = props.getProperty(PROP_NOTIFY_EMAIL);
  const colorRules = getEventColorRules(props);

  const source = loadMoodleEvents(props);
  const syncHash = createSyncHash(source.hashInput, moduleOverrides, moduleNames, reminderMinutes, source.source, colorRules);
  if (!force && props.getProperty(PROP_LAST_SYNC_HASH) === syncHash) {
    Logger.log('Moodle sync skipped. Feed and module configuration unchanged.');
    return;
  }

  const rawMoodleEvents = source.rawEvents;
  const moodleEvents = dedupeMoodleEvents(rawMoodleEvents);
  const learnedModuleNames = learnModuleNames(rawMoodleEvents);
  Object.keys(learnedModuleNames).forEach(function(code) {
    if (!moduleNames[code]) {
      moduleNames[code] = learnedModuleNames[code];
    }
  });
  const moodleVisibleKeys = getMoodleVisibleKeys(moodleEvents, moduleOverrides, moduleNames, timezone);
  const moodleUids = getMoodleUids(moodleEvents);
  const window = getSyncWindowBounds();
  const removalOptions = {
    dataSource: source.source,
    supplementWithIcal: Boolean(source.supplementWithIcal),
  };

  const existing = findExistingMoodleEvents(calendarId, window.start, window.end, moodleVisibleKeys, timezone);
  const existingByUid = existing.byUid;
  const existingByKey = existing.byKey;
  const duplicateDeletes = cleanupDuplicateSyncedEvents(calendarId, existing.duplicates, dryRun);
  const removedMissing = removeMissingMoodleEvents(
    calendarId,
    existing.events,
    moodleUids,
    moodleVisibleKeys,
    dryRun,
    removalOptions
  );
  const missingModules = countMissingModuleEvents(moodleEvents, moduleOverrides, window.start, window.end, timezone);
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let unchanged = 0;
  const handledKeys = {};
  const notificationItems = [];

  moodleEvents.forEach(function(event) {
    if (!event.uid || !event.start) {
      return;
    }

    if (!isInSyncWindow(event, window.start, window.end)) {
      skipped++;
      return;
    }

    const existing = existingByUid[event.uid];
    const resource = buildCalendarResource(event, timezone, moduleOverrides, moduleNames, reminderMinutes, colorRules);
    const resourceKey = getResourceKey(resource, timezone);
    const existingMatch = existing || existingByKey[resourceKey];

    if (handledKeys[resourceKey]) {
      skipped++;
      return;
    }
    handledKeys[resourceKey] = true;

    if (existingMatch) {
      if (
        !eventNeedsModuleRepair(existingMatch, resource) &&
        getEventContentHash(existingMatch) === resource.extendedProperties.private.contentHash
      ) {
        unchanged++;
      } else {
        if (!dryRun) {
          callCalendarWithRetry(function() {
            return Calendar.Events.update(resource, calendarId, existingMatch.id);
          });
          Utilities.sleep(250);
        }
        logDryRunAction(dryRun, 'update', resource);
        notificationItems.push(buildNotificationItem('Updated', resource, timezone));
        updated++;
      }
      existingByKey[resourceKey] = existingMatch;
    } else {
      if (!dryRun) {
        const inserted = callCalendarWithRetry(function() {
          return Calendar.Events.insert(resource, calendarId);
        });
        existingByKey[resourceKey] = inserted;
        Utilities.sleep(250);
      }
      logDryRunAction(dryRun, 'create', resource);
      notificationItems.push(buildNotificationItem('New', resource, timezone));
      created++;
    }
  });

  if (!dryRun) {
    props.setProperty(PROP_LAST_SYNC_HASH, syncHash);
    sendSyncNotifications(notifyEmail, notificationItems);
  }
  Logger.log(formatSyncReport({
    title: dryRun ? 'Moodle dry run complete' : 'Moodle sync complete',
    source: source.source,
    calendarId: calendarId,
    dryRun: dryRun,
    triggerInstalled: hasSyncTrigger(),
    created: created,
    updated: updated,
    unchanged: unchanged,
    skipped: skipped,
    deletedDuplicates: duplicateDeletes,
    removedMissing: removedMissing,
    sourceEvents: rawMoodleEvents.length,
    dedupedEvents: moodleEvents.length,
    missingModules: missingModules,
  }));
}

function formatSyncReport(report) {
  return [
    report.title,
    'Source: ' + report.source,
    'Calendar ID: ' + report.calendarId,
    'Dry run: ' + (report.dryRun ? 'yes' : 'no'),
    'Created: ' + report.created,
    'Updated: ' + report.updated,
    'Unchanged: ' + report.unchanged,
    'Skipped: ' + report.skipped,
    'Deleted duplicates: ' + report.deletedDuplicates,
    'Removed missing Moodle events: ' + report.removedMissing,
    'Source events: ' + report.sourceEvents,
    'Deduped events: ' + report.dedupedEvents,
    'Events missing module: ' + report.missingModules,
    'Hourly trigger installed: ' + (report.triggerInstalled ? 'yes' : 'no'),
  ].join('\n');
}

function countMissingModuleEvents(events, moduleOverrides, now, horizon, timezone) {
  return events.filter(function(event) {
    return event.uid &&
      event.start &&
      isInSyncWindow(event, now, horizon) &&
      !extractModuleCode(event, moduleOverrides, timezone);
  }).length;
}

function buildNotificationItem(action, resource, timezone) {
  const privateProps = resource.extendedProperties && resource.extendedProperties.private || {};
  return {
    action: action,
    title: resource.summary || 'Moodle event',
    when: formatCalendarTimeForNotification(resource.start, timezone),
    moduleCode: privateProps.moduleCode || '',
    moduleName: privateProps.moduleName || '',
  };
}

function sendSyncNotifications(email, items) {
  if (!email || !items.length) {
    return;
  }

  MailApp.sendEmail({
    to: email,
    subject: formatNotificationSubject(items),
    body: formatNotificationBody(items),
    htmlBody: formatNotificationHtml(items),
  });
  Logger.log('Notification email sent to %s for %s Moodle change(s).', email, items.length);
}

function getSampleNotificationItems() {
  return [
    {
      action: 'New',
      title: 'MA3024: Spot Quiz 02 closes',
      when: 'Tue, 14 Jul 2026, 3:00 PM',
      moduleCode: 'MA3024',
      moduleName: 'Numerical Methods',
    },
    {
      action: 'Updated',
      title: 'CS3501: Project Proposal Submission is due',
      when: 'Wed, 15 Jul 2026, 11:59 PM',
      moduleCode: 'CS3501',
      moduleName: 'Data Science and Engineering Project',
    },
  ];
}

function formatNotificationSubject(items) {
  if (items.length === 1) {
    return 'Moodle Calendar: ' + items[0].action + ' deadline';
  }
  return 'Moodle Calendar: ' + items.length + ' deadline changes';
}

function formatNotificationBody(items) {
  const visibleItems = items.slice(0, 20);
  const lines = [
    'Moodle Calendar changes:',
    '',
  ];

  visibleItems.forEach(function(item) {
    lines.push(item.action + ': ' + item.title);
    if (item.when) lines.push('Due: ' + item.when);
    if (item.moduleCode || item.moduleName) {
      lines.push('Module: ' + [item.moduleCode, item.moduleName].filter(Boolean).join(' - '));
    }
    lines.push('');
  });

  if (items.length > visibleItems.length) {
    lines.push('And ' + (items.length - visibleItems.length) + ' more change(s).');
    lines.push('');
  }

  lines.push('This email was sent by moodle-calendar-sync.');
  return lines.join('\n');
}

function formatNotificationHtml(items) {
  const visibleItems = items.slice(0, 20);
  const created = items.filter(function(item) { return item.action === 'New'; }).length;
  const updated = items.filter(function(item) { return item.action === 'Updated'; }).length;
  const hiddenCount = items.length - visibleItems.length;
  const rows = visibleItems.map(function(item) {
    const isNew = item.action === 'New';
    const badgeColor = isNew ? '#0f5132' : '#7a4b00';
    const badgeBackground = isNew ? '#dff6e8' : '#fff2cc';
    const accentColor = isNew ? '#1a7f37' : '#d97706';
    const moduleText = [item.moduleCode, item.moduleName].filter(Boolean).join(' - ');
    return [
      '<tr>',
      '<td style="padding:0 0 12px 0;">',
      '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid #dfe3eb;border-radius:14px;overflow:hidden;">',
      '<tr>',
      '<td style="width:5px;background:', accentColor, ';font-size:0;line-height:0;">&nbsp;</td>',
      '<td style="padding:16px 18px 15px 18px;">',
      '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">',
      '<tr>',
      '<td style="padding:0 0 10px 0;">',
      '<span style="display:inline-block;border-radius:999px;background:', badgeBackground, ';color:', badgeColor, ';font-size:11px;font-weight:800;line-height:20px;padding:1px 10px;text-transform:uppercase;letter-spacing:.35px;">', escapeHtml(item.action), '</span>',
      moduleText ? '<span style="display:inline-block;margin-left:7px;border-radius:999px;background:#eef2ff;color:#243c7a;font-size:12px;font-weight:700;line-height:20px;padding:1px 10px;">' + escapeHtml(item.moduleCode || 'Module') + '</span>' : '',
      '</td>',
      '</tr>',
      '<tr>',
      '<td style="font-size:17px;line-height:24px;font-weight:800;color:#111827;padding:0 0 10px 0;">', escapeHtml(item.title), '</td>',
      '</tr>',
      item.when ? '<tr><td style="font-size:14px;line-height:21px;color:#374151;padding:0 0 5px 0;"><span style="color:#6b7280;font-weight:700;">Due</span>&nbsp;&nbsp;' + escapeHtml(item.when) + '</td></tr>' : '',
      moduleText ? '<tr><td style="font-size:14px;line-height:21px;color:#374151;padding:0;"><span style="color:#6b7280;font-weight:700;">Module</span>&nbsp;&nbsp;' + escapeHtml(moduleText) + '</td></tr>' : '',
      '</table>',
      '</td>',
      '</tr>',
      '</table>',
      '</td>',
      '</tr>',
    ].join('');
  }).join('');

  return [
    '<div style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#111827;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f4f7fb;">',
    '<tr>',
    '<td align="center" style="padding:30px 14px;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:720px;border-collapse:separate;border-spacing:0;">',
    '<tr>',
    '<td style="background:#ffffff;border:1px solid #dfe3eb;border-top:6px solid #2563eb;border-bottom:0;border-radius:18px 18px 0 0;padding:28px 30px 24px;color:#111827;">',
    '<div style="font-size:12px;line-height:18px;font-weight:800;letter-spacing:1.1px;text-transform:uppercase;color:#2563eb;">Moodle Calendar Sync</div>',
    '<div style="font-size:30px;line-height:38px;font-weight:800;margin-top:6px;color:#111827;">', items.length, ' deadline change', items.length === 1 ? '' : 's', '</div>',
    '<div style="font-size:14px;line-height:21px;color:#4b5563;margin-top:8px;">New and updated Moodle deadlines synced to Google Calendar.</div>',
    '<div style="margin-top:14px;"><span style="display:inline-block;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:700;line-height:20px;padding:3px 10px;">Google Calendar updated</span></div>',
    '</td>',
    '</tr>',
    '<tr>',
    '<td style="background:#ffffff;border-left:1px solid #dfe3eb;border-right:1px solid #dfe3eb;padding:18px 22px;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;border-spacing:8px;">',
    '<tr>',
    '<td style="width:50%;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:14px 16px;">',
    '<div style="font-size:12px;line-height:16px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#166534;">New</div>',
    '<div style="font-size:28px;line-height:34px;font-weight:800;color:#14532d;margin-top:2px;">', created, '</div>',
    '</td>',
    '<td style="width:50%;background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:14px 16px;">',
    '<div style="font-size:12px;line-height:16px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#92400e;">Updated</div>',
    '<div style="font-size:28px;line-height:34px;font-weight:800;color:#78350f;margin-top:2px;">', updated, '</div>',
    '</td>',
    '</tr>',
    '</table>',
    '</td>',
    '</tr>',
    '<tr>',
    '<td style="background:#ffffff;border-left:1px solid #dfe3eb;border-right:1px solid #dfe3eb;padding:4px 22px 10px 22px;">',
    '<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">',
    rows,
    '</table>',
    hiddenCount > 0 ? '<div style="background:#f8fafc;border:1px dashed #cbd5e1;border-radius:12px;font-size:14px;line-height:20px;color:#475569;padding:13px 15px;margin:2px 0 12px;">And ' + hiddenCount + ' more change(s).</div>' : '',
    '</td>',
    '</tr>',
    '<tr>',
    '<td style="background:#f8fafc;border:1px solid #dfe3eb;border-top:0;border-radius:0 0 18px 18px;padding:16px 24px;font-size:12px;line-height:18px;color:#64748b;">This email was sent by moodle-calendar-sync. You receive this only when synced Moodle deadlines are created or updated.</td>',
    '</tr>',
    '</table>',
    '</td>',
    '</tr>',
    '</table>',
    '</div>',
  ].join('');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCalendarTimeForNotification(start, timezone) {
  if (!start) {
    return '';
  }
  if (start.date) {
    return start.date;
  }
  if (!start.dateTime) {
    return '';
  }
  return Utilities.formatDate(new Date(start.dateTime), timezone || 'UTC', 'EEE, d MMM yyyy, h:mm a');
}

function cleanupMoodleCalendarDuplicates() {
  const props = PropertiesService.getScriptProperties();
  const icalUrl = props.getProperty(PROP_MOODLE_ICAL_URL);
  const calendarId = props.getProperty(PROP_MOODLE_CALENDAR_ID) || 'primary';
  const timezone = props.getProperty(PROP_TIMEZONE) || Session.getScriptTimeZone();
  const moduleOverrides = getModuleOverrides(props);
  const moduleNames = getModuleNames(props);

  if (!icalUrl) {
    throw new Error('Missing script property: ' + PROP_MOODLE_ICAL_URL);
  }

  const rawMoodleEvents = parseIcsEvents(fetchIcs(icalUrl));
  const moodleEvents = dedupeMoodleEvents(rawMoodleEvents);
  const learnedModuleNames = learnModuleNames(rawMoodleEvents);
  Object.keys(learnedModuleNames).forEach(function(code) {
    if (!moduleNames[code]) {
      moduleNames[code] = learnedModuleNames[code];
    }
  });
  const moodleVisibleKeys = getMoodleVisibleKeys(moodleEvents, moduleOverrides, moduleNames, timezone);
  const now = new Date(SYNC_START_DATE + 'T00:00:00Z');
  const horizon = new Date(SYNC_END_DATE + 'T23:59:59Z');
  const existing = findExistingMoodleEvents(calendarId, now, horizon, moodleVisibleKeys, timezone);
  const deleted = cleanupDuplicateSyncedEvents(calendarId, existing.duplicates);

  Logger.log('Duplicate cleanup complete. Deleted: %s', deleted);
}

function resetSyncState() {
  PropertiesService.getScriptProperties().deleteProperty(PROP_LAST_SYNC_HASH);
  Logger.log('Sync state reset. Next sync will not use the cached feed hash.');
}

function deleteAllSyncedMoodleEvents() {
  const props = PropertiesService.getScriptProperties();
  const calendarId = props.getProperty(PROP_MOODLE_CALENDAR_ID) || 'primary';
  const now = new Date(SYNC_START_DATE + 'T00:00:00Z');
  const horizon = new Date(SYNC_END_DATE + 'T23:59:59Z');
  const events = findScriptOwnedMoodleEvents(calendarId, now, horizon);
  const deleted = removeCalendarEvents(calendarId, events, false);

  props.deleteProperty(PROP_LAST_SYNC_HASH);
  Logger.log('Deleted all synced Moodle events from %s. Deleted: %s. Sync state reset.', calendarId, deleted);
}

function dryRunDeleteAllSyncedMoodleEvents() {
  const props = PropertiesService.getScriptProperties();
  const calendarId = props.getProperty(PROP_MOODLE_CALENDAR_ID) || 'primary';
  const now = new Date(SYNC_START_DATE + 'T00:00:00Z');
  const horizon = new Date(SYNC_END_DATE + 'T23:59:59Z');
  const events = findScriptOwnedMoodleEvents(calendarId, now, horizon);
  const deleted = removeCalendarEvents(calendarId, events, true);

  Logger.log('Dry run delete all synced Moodle events from %s. Would delete: %s', calendarId, deleted);
}

function getModuleResolutionSource(event, moduleOverrides, timezone) {
  if (extractModuleCodeFromCourseFields(event)) {
    return 'course';
  }

  if (getModuleCodeFromKeyOverrides(event, moduleOverrides.byKey, timezone)) {
    return 'byKey';
  }

  if (moduleOverrides.byUid && moduleOverrides.byUid[event.uid]) {
    return 'byUid';
  }

  const titleOverride = moduleOverrides.byTitle && moduleOverrides.byTitle[normalizeKeyPart(event.summary || '')];
  if (titleOverride) {
    return 'byTitle';
  }

  if (getModuleCodeFromTitlePrefix(event.summary, moduleOverrides.byTitlePrefix)) {
    return 'byTitlePrefix';
  }

  const text = [
    event.summary || '',
    event.description || '',
    event.location || '',
    event.url || '',
    event.uid || '',
  ].join('\n');
  const match = text.match(/\b[A-Z]{2,4}\s?\d{4}\b/);

  return match ? 'text' : 'missing';
}

function inspectModuleResolution() {
  const props = PropertiesService.getScriptProperties();
  const timezone = getScriptTimezone(props);
  const moduleOverrides = getModuleOverrides(props);
  const source = loadMoodleEvents(props);
  const events = dedupeMoodleEvents(source.rawEvents || []);
  const counts = {
    course: 0,
    byKey: 0,
    byUid: 0,
    byTitle: 0,
    byTitlePrefix: 0,
    text: 0,
    missing: 0,
  };

  Logger.log('Inspecting module resolution for %s events from source: %s', events.length, source.source);
  events.forEach(function(event) {
    const sourceName = getModuleResolutionSource(event, moduleOverrides, timezone);
    const moduleCode = extractModuleCode(event, moduleOverrides, timezone);
    counts[sourceName] = (counts[sourceName] || 0) + 1;

    if (sourceName !== 'course' && sourceName !== 'text') {
      Logger.log(
        'Manual override | source=%s | module=%s | title="%s" | uid="%s" | course="%s"',
        sourceName,
        moduleCode || '(missing)',
        event.summary || '',
        event.uid || '',
        event.courseShortName || event.courseFullName || ''
      );
    }
    if (sourceName === 'missing') {
      Logger.log(
        'Missing module | title="%s" | uid="%s" | start="%s" | course="%s"',
        event.summary || '',
        event.uid || '',
        getParsedDateKey(event.start),
        event.courseShortName || event.courseFullName || ''
      );
    }
  });

  Logger.log('Module resolution summary: %s', JSON.stringify(counts));
  Logger.log(
    'Automatic: %s | Manual overrides: %s | Missing: %s',
    (counts.course || 0) + (counts.text || 0),
    (counts.byKey || 0) + (counts.byUid || 0) + (counts.byTitle || 0) + (counts.byTitlePrefix || 0),
    counts.missing || 0
  );
}

function inspectAmbiguousMoodleEvents() {
  const props = PropertiesService.getScriptProperties();
  const timezone = getScriptTimezone(props);
  const moduleOverrides = getModuleOverrides(props);
  const source = loadMoodleEvents(props);
  const events = dedupeMoodleEvents(source.rawEvents || []);

  Logger.log('Inspecting %s Moodle events from source: %s', events.length, source.source);
  events.forEach(function(event) {
    const moduleCode = extractModuleCode(event, moduleOverrides, timezone);
    if (!moduleCode) {
      Logger.log(
        'Ambiguous Moodle event | title="%s" | uid="%s" | start="%s" | keys="%s" | course="%s" | description="%s"',
        event.summary || '',
        event.uid || '',
        getParsedDateKey(event.start),
        getMoodleEventKeyVariants(event, timezone).join(', '),
        event.courseFullName || event.courseShortName || '',
        shortenForLog(event.description || '')
      );
    }
  });
}

function inspectAttendanceEvents() {
  const props = PropertiesService.getScriptProperties();
  const timezone = getScriptTimezone(props);
  const moduleOverrides = getModuleOverrides(props);
  const source = loadMoodleEvents(props);
  const events = dedupeMoodleEvents(source.rawEvents || [])
    .filter(function(event) {
      return normalizeTitleForKey(event.summary || '') === 'attendance';
    })
    .sort(function(a, b) {
      return getParsedDateKey(a.start).localeCompare(getParsedDateKey(b.start));
    });

  Logger.log('Found %s attendance events from source: %s', events.length, source.source);
  const byKeySuggestions = {};
  const byUidSuggestions = {};

  events.forEach(function(event) {
    const moduleCode = extractModuleCode(event, moduleOverrides, timezone);
    const dateKey = getAttendanceDateKey(event, timezone);
    const fromCourse = extractModuleCodeFromCourseFields(event);
    const fromUid = moduleOverrides.byUid && moduleOverrides.byUid[event.uid];
    const fromKey = getModuleCodeFromKeyOverrides(event, moduleOverrides.byKey, timezone);
    const sourceLabel = fromKey
      ? 'byKey'
      : (fromCourse ? 'course' : (fromUid ? 'byUid' : 'missing'));

    Logger.log(
      'Attendance | date=%s | uid="%s" | module=%s | source=%s | course="%s" | byKey="attendance|%s"',
      dateKey,
      event.uid || '',
      moduleCode || '(missing)',
      sourceLabel,
      event.courseFullName || event.courseShortName || '',
      dateKey
    );

    if (sourceLabel === 'byUid' && !fromCourse) {
      byUidSuggestions[event.uid] = 'MODULE_CODE';
    }
    if (!moduleCode) {
      byKeySuggestions['attendance|' + dateKey] = 'MODULE_CODE';
    }
  });

  if (Object.keys(byKeySuggestions).length) {
    Logger.log('Suggested byKey entries:\n%s', JSON.stringify(byKeySuggestions, null, 2));
  }
  if (Object.keys(byUidSuggestions).length) {
    Logger.log('Attendance events currently using byUid only (review these):\n%s', JSON.stringify(byUidSuggestions, null, 2));
  }
}

function getAttendanceDateKey(event, timezone) {
  if (timezone) {
    const start = event.start && event.start.dateOnly
      ? { date: event.start.date }
      : { dateTime: event.start && event.start.dateTime };
    const tzDate = getMatchingDateKey(start, timezone);
    if (tzDate) {
      return tzDate.slice(0, 10);
    }
  }

  const variants = getMoodleEventKeyVariants(event, timezone);
  for (let i = 0; i < variants.length; i++) {
    const parts = variants[i].split('|');
    if (parts.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(parts[1])) {
      return parts[1];
    }
  }

  const rawDate = getParsedDateKey(event.start);
  return rawDate ? rawDate.slice(0, 10) : '';
}

function inspectLearnedModuleNames() {
  const props = PropertiesService.getScriptProperties();
  const source = loadMoodleEvents(props);
  const names = learnModuleNames(source.rawEvents || []);

  Logger.log('Learned module names from source: %s', source.source);
  Logger.log(JSON.stringify(names, null, 2));
}

function findOrCreateCalendar(calendarName, timezone) {
  let pageToken;

  do {
    const result = Calendar.CalendarList.list({
      minAccessRole: 'owner',
      pageToken: pageToken,
    });

    const calendars = result.items || [];
    for (let i = 0; i < calendars.length; i++) {
      if (calendars[i].summary === calendarName) {
        return calendars[i];
      }
    }

    pageToken = result.nextPageToken;
  } while (pageToken);

  return Calendar.Calendars.insert({
    summary: calendarName,
    timeZone: timezone,
    description: 'Moodle deadlines synced by Moodle Calendar Sync.',
  });
}

function getScriptTimezone(props) {
  return (props && props.getProperty(PROP_TIMEZONE)) ||
    (typeof Session !== 'undefined' ? Session.getScriptTimeZone() : 'UTC');
}

function loadMoodleEvents(props) {
  const dataSource = getMoodleDataSource(props);
  if (dataSource === DATA_SOURCE_API) {
    const apiResult = loadMoodleApiEvents(props);
    const icalUrl = props.getProperty(PROP_MOODLE_ICAL_URL);
    if (!icalUrl) {
      return Object.assign({}, apiResult, { supplementWithIcal: false });
    }

    try {
      const icalResult = loadMoodleIcsEvents(props);
      return Object.assign(
        mergeMoodleEventSources(apiResult, icalResult, props),
        { supplementWithIcal: true }
      );
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      Logger.log('iCal supplement unavailable; using API events only. %s', message);
      return Object.assign({}, apiResult, { supplementWithIcal: false });
    }
  }

  return Object.assign(loadMoodleIcsEvents(props), { supplementWithIcal: false });
}

function getMoodleUrlId(url) {
  const match = String(url || '').match(/[?&]id=(\d+)/);
  return match ? match[1] : '';
}

function getIcalCalendarEventId(uid) {
  const match = String(uid || '').match(/^(\d+)@/);
  return match ? match[1] : '';
}

function getNeutralMoodleMatchKey(event, timezone) {
  const start = event.start.dateOnly
    ? { date: event.start.date }
    : { dateTime: event.start.dateTime };

  return getMatchingEventKey({
    summary: event.summary || 'Moodle event',
    start: start,
  }, timezone);
}

function buildApiEventIndexes(apiEvents, timezone) {
  const byNeutralKey = {};
  const byUrlId = {};
  const byCalendarId = {};

  (apiEvents || []).forEach(function(event) {
    if (!event || !event.start) {
      return;
    }

    byNeutralKey[getNeutralMoodleMatchKey(event, timezone)] = event;
    const urlId = getMoodleUrlId(event.url);
    if (urlId) {
      byUrlId[urlId] = event;
    }
    const calendarId = event.calendarEventId || getIcalCalendarEventId(event.uid);
    if (calendarId) {
      byCalendarId[calendarId] = event;
    }
  });

  return {
    byNeutralKey: byNeutralKey,
    byUrlId: byUrlId,
    byCalendarId: byCalendarId,
  };
}

function mergeEventCourseFields(target, source) {
  if (!source || (!source.courseFullName && !source.courseShortName)) {
    return target;
  }

  return Object.assign({}, target, {
    courseFullName: source.courseFullName || target.courseFullName || '',
    courseShortName: source.courseShortName || target.courseShortName || '',
    courseId: source.courseId || target.courseId || '',
    url: target.url || source.url || '',
  });
}

function enrichMoodleEventWithApiCourseMetadata(event, apiIndexes, timezone) {
  if (!event || extractModuleCodeFromCourseFields(event)) {
    return event;
  }

  apiIndexes = apiIndexes || { byNeutralKey: {}, byUrlId: {}, byCalendarId: {} };
  const calendarId = getIcalCalendarEventId(event.uid);
  if (calendarId && apiIndexes.byCalendarId && apiIndexes.byCalendarId[calendarId]) {
    return mergeEventCourseFields(event, apiIndexes.byCalendarId[calendarId]);
  }

  let apiEvent = apiIndexes.byNeutralKey[getNeutralMoodleMatchKey(event, timezone)];
  if (!apiEvent) {
    const urlId = getMoodleUrlId(event.url);
    if (urlId) {
      apiEvent = apiIndexes.byUrlId[urlId];
    }
  }

  return mergeEventCourseFields(event, apiEvent);
}

function mergeMoodleEventSources(apiResult, icalResult, props) {
  const timezone = getScriptTimezone(props);
  const moduleOverrides = getModuleOverrides(props);
  const moduleNames = getModuleNames(props);
  const apiIndexes = buildApiEventIndexes(apiResult.rawEvents || [], timezone);
  const byKey = {};

  function addEvent(event, prefer) {
    if (!event.uid || !event.start) {
      return;
    }

    const neutralKey = getNeutralMoodleMatchKey(event, timezone);
    const enriched = enrichMoodleEventWithApiCourseMetadata(event, apiIndexes, timezone);
    if (!byKey[neutralKey] || prefer) {
      byKey[neutralKey] = prefer ? event : enriched;
      return;
    }

    if (!byKey[neutralKey].courseFullName && enriched.courseFullName) {
      byKey[neutralKey] = mergeEventCourseFields(byKey[neutralKey], enriched);
    }
  }

  (apiResult.rawEvents || []).forEach(function(event) {
    addEvent(event, true);
  });
  (icalResult.rawEvents || []).forEach(function(event) {
    addEvent(event, false);
  });

  return {
    source: DATA_SOURCE_API,
    hashInput: [apiResult.hashInput, icalResult.hashInput].join('\n---\n'),
    rawEvents: Object.keys(byKey).map(function(key) {
      return byKey[key];
    }),
  };
}

function loadMoodleIcsEvents(props) {
  const icalUrl = props.getProperty(PROP_MOODLE_ICAL_URL);
  if (!icalUrl) {
    throw new Error('Missing script property: ' + PROP_MOODLE_ICAL_URL);
  }

  const icsText = fetchIcs(icalUrl);
  return {
    source: DATA_SOURCE_ICAL,
    hashInput: icsText,
    rawEvents: parseIcsEvents(icsText),
  };
}

function getSyncWindowBounds() {
  return {
    start: new Date(SYNC_START_DATE + 'T00:00:00Z'),
    end: new Date(SYNC_END_DATE + 'T23:59:59Z'),
  };
}

function dateToUnixSeconds(date) {
  return Math.floor(date.getTime() / 1000);
}

function buildMoodleApiTimesortParams(windowStart, windowEnd) {
  return {
    timesortfrom: dateToUnixSeconds(windowStart),
    timesortto: dateToUnixSeconds(windowEnd),
    limitnum: MOODLE_API_PAGE_SIZE,
  };
}

function paginateMoodleApiEventPages(fetchPage, windowStart, windowEnd) {
  const baseParams = buildMoodleApiTimesortParams(windowStart, windowEnd);
  const allEvents = [];
  const seenIds = {};
  let aftereventid = 0;

  for (let page = 0; page < MOODLE_API_MAX_PAGES; page++) {
    const params = Object.assign({}, baseParams);
    if (aftereventid) {
      params.aftereventid = aftereventid;
    }

    const apiEvents = fetchPage(params) || [];
    if (!apiEvents.length) {
      break;
    }

    apiEvents.forEach(function(event) {
      if (!event || event.id == null || seenIds[event.id]) {
        return;
      }
      seenIds[event.id] = true;
      allEvents.push(event);
    });

    if (apiEvents.length < MOODLE_API_PAGE_SIZE) {
      break;
    }

    const lastEvent = apiEvents[apiEvents.length - 1];
    if (!lastEvent || lastEvent.id == null || lastEvent.id === aftereventid) {
      break;
    }
    aftereventid = lastEvent.id;
  }

  return allEvents;
}

function loadMoodleApiEvents(props) {
  const apiBase = getMoodleApiBase(props);
  const token = props.getProperty(PROP_MOODLE_TOKEN);
  if (!token) {
    throw new Error('Missing script property: ' + PROP_MOODLE_TOKEN);
  }

  const window = getSyncWindowBounds();
  const courseMap = loadUserCoursesMap(props, apiBase, token);
  const apiEvents = paginateMoodleApiEventPages(function(params) {
    const payload = callMoodleApi(apiBase, token, 'core_calendar_get_action_events_by_timesort', params);
    return payload.events || [];
  }, window.start, window.end);
  const calendarEvents = loadMoodleCalendarApiEvents(props, apiBase, token, courseMap);
  const normalizedActionEvents = apiEvents.map(function(event) {
    return normalizeMoodleApiEvent(event, apiBase);
  });
  const actionCalendarIds = {};
  normalizedActionEvents.forEach(function(event) {
    const calendarId = getIcalCalendarEventId(event.uid);
    if (calendarId) {
      actionCalendarIds[calendarId] = true;
    }
  });
  const supplementalCalendarEvents = calendarEvents.filter(function(event) {
    return !actionCalendarIds[event.calendarEventId];
  });

  return {
    source: DATA_SOURCE_API,
    hashInput: JSON.stringify({
      actionEvents: apiEvents,
      calendarEvents: calendarEvents.map(function(event) {
        return {
          id: event.calendarEventId,
          summary: event.summary,
          courseShortName: event.courseShortName,
          start: getParsedDateKey(event.start),
        };
      }),
    }),
    rawEvents: normalizedActionEvents.concat(supplementalCalendarEvents),
  };
}

function loadUserCoursesMap(props, apiBase, token) {
  apiBase = apiBase || getMoodleApiBase(props);
  token = token || props.getProperty(PROP_MOODLE_TOKEN);
  if (!token) {
    return {};
  }

  try {
    const courses = callMoodleApi(apiBase, token, 'core_enrol_get_users_courses', {
      userid: 0,
    });
    const map = {};
    (courses || []).forEach(function(course) {
      map[String(course.id)] = {
        shortname: stripHtml(course.shortname || ''),
        fullname: stripHtml(course.fullname || ''),
      };
    });
    return map;
  } catch (error) {
    Logger.log(
      'Could not load enrolled courses for automatic module detection: %s',
      error && error.message ? error.message : String(error)
    );
    return {};
  }
}

function loadMoodleCalendarApiEvents(props, apiBase, token, courseMap) {
  apiBase = apiBase || getMoodleApiBase(props);
  token = token || props.getProperty(PROP_MOODLE_TOKEN);
  courseMap = courseMap || {};
  if (!token) {
    return [];
  }

  const window = getSyncWindowBounds();
  try {
    const courseIds = Object.keys(courseMap).map(function(id) {
      return Number(id);
    }).filter(function(id) {
      return Number.isFinite(id);
    });
    const payload = callMoodleApi(apiBase, token, 'core_calendar_get_calendar_events', {
      events: {
        courseids: courseIds,
      },
      options: {
        timestart: dateToUnixSeconds(window.start),
        timeend: dateToUnixSeconds(window.end),
        userevents: 1,
        siteevents: 1,
        ignorehidden: 1,
      },
    });
    return (payload.events || []).map(function(event) {
      return normalizeMoodleCalendarEvent(event, apiBase, courseMap);
    });
  } catch (error) {
    Logger.log(
      'Calendar API enrichment unavailable; iCal course metadata is still used: %s',
      error && error.message ? error.message : String(error)
    );
    return [];
  }
}

function normalizeMoodleCalendarEvent(calendarEvent, apiBase, courseMap) {
  const courseId = String(calendarEvent.courseid || '');
  const course = courseMap[courseId] || {};
  const host = apiBase.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const start = calendarEvent.timestart;
  const duration = calendarEvent.timeduration || 0;
  const end = duration > 0 ? start + duration : start;

  return {
    uid: calendarEvent.id + '@' + host,
    calendarEventId: String(calendarEvent.id),
    summary: stripHtml(calendarEvent.name || 'Moodle event'),
    description: stripHtml(calendarEvent.description || ''),
    location: stripHtml(calendarEvent.location || ''),
    url: stripHtml(calendarEvent.url || ''),
    start: unixTimestampToParsedDate(start),
    end: unixTimestampToParsedDate(end),
    courseFullName: course.fullname || '',
    courseShortName: course.shortname || '',
    courseId: courseId,
    moduleName: calendarEvent.modulename || '',
    eventType: calendarEvent.eventtype || '',
  };
}

function callMoodleApi(apiBase, token, wsfunction, params) {
  const query = Object.assign({}, params || {}, {
    wstoken: token,
    wsfunction: wsfunction,
    moodlewsrestformat: 'json',
  });
  const url = apiBase.replace(/\/$/, '') + '/webservice/rest/server.php?' + toQueryString(query);
  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Moodle API call failed. HTTP ' + code);
  }

  const body = response.getContentText();
  const json = JSON.parse(body);
  if (json.exception || json.errorcode || json.error) {
    throw new Error('Moodle API error: ' + (json.message || json.error || json.errorcode));
  }
  return json;
}

function normalizeMoodleApiEvent(apiEvent, apiBase) {
  const course = apiEvent.course || {};
  const start = apiEvent.timestart || apiEvent.timesort;
  const duration = apiEvent.timeduration || 0;
  const end = duration > 0 ? start + duration : start;
  const url = apiEvent.url || (apiEvent.action && apiEvent.action.url) || apiEvent.viewurl || '';

  return {
    uid: 'api:' + apiEvent.id + '@' + apiBase.replace(/^https?:\/\//, '').replace(/\/$/, ''),
    summary: stripHtml(apiEvent.name || apiEvent.activityname || 'Moodle event'),
    description: stripHtml(apiEvent.description || ''),
    location: stripHtml(apiEvent.location || ''),
    url: url,
    start: unixTimestampToParsedDate(start),
    end: unixTimestampToParsedDate(end),
    courseFullName: stripHtml(course.fullname || course.fullnamedisplay || ''),
    courseShortName: stripHtml(course.shortname || ''),
    courseId: course.id || '',
    component: apiEvent.component || '',
    moduleName: apiEvent.modulename || '',
    eventType: apiEvent.eventtype || '',
    actionName: apiEvent.action && apiEvent.action.name ? apiEvent.action.name : '',
  };
}

function unixTimestampToParsedDate(timestamp) {
  const date = new Date(Number(timestamp) * 1000);
  return {
    dateTime: date.toISOString().replace('.000Z', 'Z'),
    dateOnly: false,
  };
}

function fetchIcs(url) {
  const response = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Failed to fetch Moodle iCal. HTTP ' + code);
  }
  return response.getContentText();
}

function createSyncHash(sourceText, moduleOverrides, moduleNames, reminderMinutes, sourceName, colorRules) {
  return createHash([
    sourceName || '',
    sourceText,
    JSON.stringify(moduleOverrides),
    JSON.stringify(moduleNames),
    JSON.stringify(reminderMinutes),
    JSON.stringify(colorRules || {}),
    SYNC_START_DATE,
    SYNC_END_DATE,
  ].join('\n'));
}

function toQueryString(params) {
  const parts = [];
  Object.keys(params).forEach(function(key) {
    appendQueryParam(parts, key, params[key]);
  });
  return parts.join('&');
}

function appendQueryParam(parts, prefix, value) {
  if (value === null || value === undefined) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(function(item, index) {
      appendQueryParam(parts, prefix + '[' + index + ']', item);
    });
    return;
  }

  if (typeof value === 'object') {
    Object.keys(value).forEach(function(key) {
      appendQueryParam(parts, prefix + '[' + key + ']', value[key]);
    });
    return;
  }

  parts.push(encodeURIComponent(prefix) + '=' + encodeURIComponent(String(value)));
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function createHash(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(byte) {
    const unsigned = byte < 0 ? byte + 256 : byte;
    return ('0' + unsigned.toString(16)).slice(-2);
  }).join('');
}

function parseIcsEvents(icsText) {
  return unfoldIcsLines(icsText)
    .reduce(function(state, line) {
      if (line === 'BEGIN:VEVENT') {
        state.current = {};
      } else if (line === 'END:VEVENT') {
        state.events.push(state.current);
        state.current = null;
      } else if (state.current) {
        applyIcsLine(state.current, line);
      }
      return state;
    }, { events: [], current: null })
    .events;
}

function dedupeMoodleEvents(events) {
  const byKey = {};

  events.forEach(function(event) {
    if (!event.uid || !event.start) {
      return;
    }

    const key = getMoodleEventKey(event);
    const existing = byKey[key];
    if (!existing || String(event.description || '').length > String(existing.description || '').length) {
      byKey[key] = event;
    }
  });

  return Object.keys(byKey).map(function(key) {
    return byKey[key];
  });
}

function getMoodleEventKey(event) {
  return normalizeMoodleEventKey([
    normalizeTitleForKey(event.summary || 'Moodle event'),
    getParsedDateKey(event.start),
  ].join('|'));
}

function normalizeMoodleEventKey(key) {
  return normalizeKeyPart(key);
}

function getMoodleEventKeyVariants(event, timezone) {
  const titleKey = normalizeTitleForKey(event.summary || 'Moodle event');
  const rawDate = getParsedDateKey(event.start);
  const start = event.start && event.start.dateOnly
    ? { date: event.start.date }
    : { dateTime: event.start && event.start.dateTime };
  const tzDate = timezone ? getMatchingDateKey(start, timezone) : '';
  const keys = [];
  const seen = {};

  function addKey(value) {
    const normalized = normalizeMoodleEventKey(value);
    if (!normalized || seen[normalized]) {
      return;
    }
    seen[normalized] = true;
    keys.push(normalized);
  }

  if (rawDate) {
    addKey(titleKey + '|' + rawDate);
    addKey(titleKey + '|' + rawDate.slice(0, 10));
  }
  if (tzDate) {
    addKey(titleKey + '|' + tzDate);
    addKey(titleKey + '|' + tzDate.slice(0, 10));
  }

  return keys;
}

function getModuleCodeFromKeyOverrides(event, byKey, timezone) {
  if (!byKey) {
    return '';
  }

  const variants = getMoodleEventKeyVariants(event, timezone);
  for (let i = 0; i < variants.length; i++) {
    if (byKey[variants[i]]) {
      return byKey[variants[i]];
    }
  }

  return '';
}

function getMoodleMatchKey(event, timezone, moduleOverrides, moduleNames) {
  const moduleCode = extractModuleCode(event, moduleOverrides, timezone);
  const moduleName = moduleCode ? moduleNames[moduleCode] || extractModuleName(event, moduleCode) : '';
  const start = event.start.dateOnly
    ? { date: event.start.date }
    : { dateTime: event.start.dateTime };

  return getMatchingEventKey({
    summary: formatEventTitle(event, moduleCode, moduleName),
    start: start,
  }, timezone);
}

function getExistingEventModuleCode(event) {
  const privateProps = event.extendedProperties && event.extendedProperties.private;
  return privateProps && privateProps.moduleCode;
}

function eventNeedsModuleRepair(existingMatch, resource) {
  const existingModuleCode = getExistingEventModuleCode(existingMatch);
  const newModuleCode = resource.extendedProperties &&
    resource.extendedProperties.private &&
    resource.extendedProperties.private.moduleCode;

  return Boolean(existingModuleCode && newModuleCode && existingModuleCode !== newModuleCode);
}

function getMoodleVisibleKeys(events, moduleOverrides, moduleNames, timezone) {
  const keys = {};
  events.forEach(function(event) {
    keys[getMoodleMatchKey(event, timezone, moduleOverrides, moduleNames)] = true;
  });
  return keys;
}

function getMoodleUids(events) {
  const uids = {};
  events.forEach(function(event) {
    if (event.uid) {
      uids[event.uid] = true;
    }
  });
  return uids;
}

function learnModuleNames(events) {
  const names = {};

  events.forEach(function(event) {
    [
      event.summary || '',
      event.description || '',
      event.location || '',
      event.url || '',
      event.courseFullName || '',
      event.courseShortName || '',
    ].forEach(function(value) {
      collectModuleNamesFromText(value, names);
    });
  });

  return names;
}

function collectModuleNamesFromText(value, names) {
  const text = String(value).replace(/\s+/g, ' ');
  const patterns = [
    /\b(?:In\d{2}-S\d-)?([A-Z]{2,4})\s?(\d{4})\s*-\s*([^()[\]\n\r|]+)/g,
    /\b([A-Z]{2,4})\s?(\d{4})\s+([^()[\]\n\r|]+?)(?:\s+\([A-Z &]+\)|$)/g,
  ];

  patterns.forEach(function(pattern) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const code = match[1] + match[2];
      const name = cleanModuleName(match[3]);
      if (name && !names[code]) {
        names[code] = name;
      }
    }
  });
}

function cleanModuleName(value) {
  return String(value)
    .replace(/\s+-\s+Dr\..*$/i, '')
    .replace(/\s+Dr\..*$/i, '')
    .replace(/\s+\([A-Z &]+\).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function unfoldIcsLines(icsText) {
  return icsText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .reduce(function(lines, line) {
      if (/^[ \t]/.test(line) && lines.length) {
        lines[lines.length - 1] += line.slice(1);
      } else {
        lines.push(line);
      }
      return lines;
    }, []);
}

function applyIcsLine(event, line) {
  const separator = line.indexOf(':');
  if (separator === -1) {
    return;
  }

  const rawName = line.slice(0, separator);
  const value = line.slice(separator + 1);
  const name = rawName.split(';')[0];

  if (name === 'UID') event.uid = value;
  if (name === 'SUMMARY') event.summary = decodeIcsText(value);
  if (name === 'DESCRIPTION') event.description = decodeIcsText(value);
  if (name === 'LOCATION') event.location = decodeIcsText(value);
  if (name === 'URL') event.url = decodeIcsText(value);
  if (name === 'CATEGORIES') {
    const categories = decodeIcsText(value).split(',').map(function(item) {
      return item.trim();
    }).filter(Boolean);
    if (categories.length && !event.courseShortName) {
      event.courseShortName = categories[0];
    }
  }
  if (name === 'DTSTART') event.start = parseIcsDate(rawName, value);
  if (name === 'DTEND') event.end = parseIcsDate(rawName, value);
}

function parseIcsDate(rawName, value) {
  const isDateOnly = rawName.indexOf('VALUE=DATE') !== -1 || /^\d{8}$/.test(value);
  if (isDateOnly) {
    return {
      date: value.slice(0, 4) + '-' + value.slice(4, 6) + '-' + value.slice(6, 8),
      dateOnly: true,
    };
  }

  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!match) {
    return null;
  }

  const iso = match[1] + '-' + match[2] + '-' + match[3] + 'T' + match[4] + ':' + match[5] + ':' + match[6] + (value.endsWith('Z') ? 'Z' : '');
  return {
    dateTime: iso,
    dateOnly: false,
  };
}

function decodeIcsText(value) {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function shortenForLog(value) {
  return String(value).replace(/\s+/g, ' ').slice(0, 300);
}

function buildCalendarResource(event, timezone, moduleOverrides, moduleNames, reminderMinutes, colorRules) {
  const moduleCode = extractModuleCode(event, moduleOverrides, timezone);
  const moduleName = moduleCode ? moduleNames[moduleCode] || extractModuleName(event, moduleCode) : '';
  const title = formatEventTitle(event, moduleCode, moduleName);
  const colorId = getEventColorId(event, moduleCode, colorRules);
  const descriptionParts = [];
  if (moduleCode && moduleName) {
    descriptionParts.push('Module: ' + moduleCode + ' - ' + moduleName);
  } else if (moduleCode) {
    descriptionParts.push('Module: ' + moduleCode);
  }
  if (shouldShowCourseLine(moduleCode, moduleName, event)) {
    descriptionParts.push('Course: ' + event.courseFullName);
  }
  if (event.description) descriptionParts.push(event.description);
  if (event.url) descriptionParts.push('Moodle: ' + event.url);

  const contentHash = createEventContentHash(event, title, moduleCode, moduleName, reminderMinutes, colorId);
  const resource = {
    summary: title,
    description: descriptionParts.join('\n\n'),
    location: event.location || '',
    reminders: {
      useDefault: false,
      overrides: reminderMinutes.map(function(minutes) {
        return {
          method: 'popup',
          minutes: minutes,
        };
      }),
    },
    extendedProperties: {
      private: {
        source: SOURCE_NAME,
        moodleUid: event.uid,
        moduleCode: moduleCode || '',
        moduleName: moduleName || '',
        contentHash: contentHash,
      },
    },
  };
  if (colorId) {
    resource.colorId = colorId;
  }

  if (event.start.dateOnly) {
    resource.start = { date: event.start.date };
    resource.end = { date: event.end && event.end.date ? event.end.date : addDays(event.start.date, 1) };
  } else {
    resource.start = { dateTime: event.start.dateTime, timeZone: timezone };
    resource.end = { dateTime: event.end && event.end.dateTime ? event.end.dateTime : event.start.dateTime, timeZone: timezone };
  }

  return resource;
}

function createEventContentHash(event, title, moduleCode, moduleName, reminderMinutes, colorId) {
  return createHash([
    event.uid || '',
    title || '',
    moduleCode || '',
    moduleName || '',
    event.description || '',
    event.location || '',
    event.url || '',
    event.courseFullName || '',
    event.courseShortName || '',
    event.courseId || '',
    getParsedDateKey(event.start),
    getParsedDateKey(event.end),
    JSON.stringify(reminderMinutes || []),
    colorId || '',
  ].join('\n'));
}

function getEventContentHash(event) {
  const privateProps = event.extendedProperties && event.extendedProperties.private;
  return privateProps && privateProps.contentHash;
}

function formatEventTitle(event, moduleCode, moduleName) {
  const title = event.summary || 'Moodle event';
  if (!moduleCode || title.indexOf(moduleCode) !== -1) {
    return title;
  }
  return moduleCode + ': ' + title;
}

function extractModuleCodeFromCourseFields(event) {
  const courseText = [
    event.courseShortName || '',
    event.courseFullName || '',
  ].join('\n');
  const match = courseText.match(/\b[A-Z]{2,4}\s?\d{4}\b/);
  return match ? match[0].replace(/\s+/g, '') : '';
}

function extractModuleCode(event, moduleOverrides, timezone) {
  const fromCourse = extractModuleCodeFromCourseFields(event);
  if (fromCourse) {
    return fromCourse;
  }

  const keyOverride = getModuleCodeFromKeyOverrides(event, moduleOverrides.byKey, timezone);
  if (keyOverride) {
    return keyOverride;
  }

  const uidOverride = moduleOverrides.byUid && moduleOverrides.byUid[event.uid];
  if (uidOverride) {
    return uidOverride;
  }

  const titleOverride = moduleOverrides.byTitle && moduleOverrides.byTitle[normalizeKeyPart(event.summary || '')];
  if (titleOverride) {
    return titleOverride;
  }

  const titlePrefixOverride = getModuleCodeFromTitlePrefix(event.summary, moduleOverrides.byTitlePrefix);
  if (titlePrefixOverride) {
    return titlePrefixOverride;
  }

  const text = [
    event.summary || '',
    event.description || '',
    event.location || '',
    event.url || '',
    event.uid || '',
  ].join('\n');

  const match = text.match(/\b[A-Z]{2,4}\s?\d{4}\b/);
  return match ? match[0].replace(/\s+/g, '') : '';
}

function extractModuleNameFromText(text, moduleCode) {
  const escapedCode = moduleCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(text || '').match(new RegExp('\\b' + escapedCode + '\\b\\s*[-:]?\\s*([^\\n\\r\\(]+)', 'i'));
  return match ? cleanModuleName(match[1]) : '';
}

function extractModuleNameFromCourseFields(event, moduleCode) {
  return extractModuleNameFromText([
    event.courseFullName || '',
    event.courseShortName || '',
  ].join('\n'), moduleCode);
}

function extractModuleName(event, moduleCode) {
  const fromCourse = extractModuleNameFromCourseFields(event, moduleCode);
  if (fromCourse) {
    return fromCourse;
  }

  return extractModuleNameFromText([
    event.summary || '',
    event.description || '',
    event.location || '',
    event.courseFullName || '',
    event.courseShortName || '',
  ].join('\n'), moduleCode);
}

function shouldShowCourseLine(moduleCode, moduleName, event) {
  if (!event.courseFullName) {
    return false;
  }

  const courseCode = extractModuleCodeFromCourseFields(event);
  if (moduleCode && courseCode && moduleCode !== courseCode) {
    return false;
  }

  if (moduleName && event.courseFullName.indexOf(moduleName) !== -1) {
    return false;
  }

  return !moduleCode || event.courseFullName.indexOf(moduleCode) === -1;
}

function getModuleOverrides(props) {
  const raw = props.getProperty(PROP_MODULE_OVERRIDES);
  if (!raw) {
    return { byUid: {}, byTitle: {}, byTitlePrefix: {}, byKey: {} };
  }

  const parsed = JSON.parse(raw);
  const byUid = parsed.byUid || {};
  const byTitle = {};
  const byTitlePrefix = {};
  const byKey = {};
  Object.keys(parsed.byTitle || {}).forEach(function(title) {
    byTitle[normalizeKeyPart(title)] = parsed.byTitle[title];
  });
  Object.keys(parsed.byTitlePrefix || {}).forEach(function(prefix) {
    byTitlePrefix[normalizeKeyPart(prefix)] = parsed.byTitlePrefix[prefix];
  });
  Object.keys(parsed.byKey || {}).forEach(function(key) {
    byKey[normalizeKeyPart(key)] = parsed.byKey[key];
  });
  const weeklyByKey = expandWeeklyOverridesToByKey(parsed.byWeekly);
  Object.keys(weeklyByKey).forEach(function(key) {
    if (!byKey[key]) {
      byKey[key] = weeklyByKey[key];
    }
  });

  return {
    byUid: byUid,
    byTitle: byTitle,
    byTitlePrefix: byTitlePrefix,
    byKey: byKey,
  };
}

function expandWeeklyOverridesToByKey(byWeekly) {
  const byKey = {};

  Object.keys(byWeekly || {}).forEach(function(titleKey) {
    const rule = byWeekly[titleKey] || {};
    const module = rule.module;
    const fromDate = rule.from;
    const toDate = rule.to;
    const weekday = parseWeekdayNumber(rule.weekday || 'friday');
    if (!module || !fromDate || !toDate || weekday === undefined) {
      return;
    }

    const normalizedTitle = normalizeTitleForKey(titleKey);
    listWeekdayDates(fromDate, toDate, weekday).forEach(function(date) {
      byKey[normalizeMoodleEventKey(normalizedTitle + '|' + date)] = module;
    });
  });

  return byKey;
}

function parseWeekdayNumber(value) {
  const weekdays = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };

  return weekdays[normalizeKeyPart(value)];
}

function listWeekdayDates(fromDate, toDate, weekday) {
  const dates = [];
  const current = parseDateOnly(fromDate);
  const end = parseDateOnly(toDate);

  while (current <= end) {
    if (current.getUTCDay() === weekday) {
      dates.push(formatDateOnly(current));
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

function parseDateOnly(value) {
  const parts = String(value).slice(0, 10).split('-');
  return new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function getModuleCodeFromTitlePrefix(summary, byTitlePrefix) {
  const normalizedSummary = normalizeKeyPart(summary || '');
  if (!normalizedSummary) {
    return '';
  }

  const prefixes = Object.keys(byTitlePrefix || {}).sort(function(a, b) {
    return b.length - a.length;
  });
  for (let i = 0; i < prefixes.length; i++) {
    const prefix = prefixes[i];
    if (normalizedSummary.indexOf(prefix) === 0) {
      return byTitlePrefix[prefix];
    }
  }

  return '';
}

function getModuleNames(props) {
  const raw = props.getProperty(PROP_MODULE_NAMES);
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function getEventColorRules(props) {
  const raw = props.getProperty(PROP_EVENT_COLOR_RULES);
  if (!raw) {
    return DEFAULT_EVENT_COLOR_RULES;
  }

  const parsed = JSON.parse(raw);
  return {
    byKeyword: Object.assign({}, DEFAULT_EVENT_COLOR_RULES.byKeyword, parsed.byKeyword || {}),
    byModule: parsed.byModule || {},
    byEventType: parsed.byEventType || {},
  };
}

function getEventColorId(event, moduleCode, colorRules) {
  const rules = colorRules || DEFAULT_EVENT_COLOR_RULES;
  const byModule = rules.byModule || {};
  const byEventType = rules.byEventType || {};
  const byKeyword = rules.byKeyword || {};

  if (moduleCode && byModule[moduleCode]) {
    return normalizeColorId(byModule[moduleCode]);
  }

  const eventType = normalizeKeyPart(event.eventType || '');
  if (eventType && byEventType[eventType]) {
    return normalizeColorId(byEventType[eventType]);
  }

  const text = normalizeKeyPart([
    event.summary || '',
    event.description || '',
    event.moduleName || '',
    event.actionName || '',
  ].join(' '));
  const keywords = Object.keys(byKeyword);
  for (let i = 0; i < keywords.length; i++) {
    const keyword = normalizeKeyPart(keywords[i]);
    if (keyword && text.indexOf(keyword) !== -1) {
      return normalizeColorId(byKeyword[keywords[i]]);
    }
  }

  return '';
}

function normalizeColorId(value) {
  const colorId = String(value || '').trim();
  return /^(?:[1-9]|1[01])$/.test(colorId) ? colorId : '';
}

function getMoodleDataSource(props) {
  const raw = props.getProperty(PROP_MOODLE_DATA_SOURCE);
  const value = raw
    ? raw.toLowerCase().trim()
    : (props.getProperty(PROP_MOODLE_TOKEN) ? DATA_SOURCE_API : DATA_SOURCE_ICAL);
  if (value !== DATA_SOURCE_API && value !== DATA_SOURCE_ICAL) {
    throw new Error('Invalid ' + PROP_MOODLE_DATA_SOURCE + ': expected "api" or "ical".');
  }
  return value;
}

function getMoodleApiBase(props) {
  return (props.getProperty(PROP_MOODLE_API_BASE) || DEFAULT_MOODLE_API_BASE).replace(/\/$/, '');
}

function getReminderMinutes(props) {
  const raw = props.getProperty(PROP_REMINDER_MINUTES);
  if (!raw) {
    return DEFAULT_REMINDER_MINUTES;
  }

  const parsed = JSON.parse(raw);
  return parsed
    .map(function(value) {
      return Number(value);
    })
    .filter(function(value) {
      return Number.isFinite(value) && value >= 0;
    });
}

function getResourceKey(resource, timezone) {
  return getMatchingEventKey(resource, timezone);
}

function getMatchingEventKey(event, timezone) {
  return [
    normalizeTitleForKey(event.summary || 'Moodle event'),
    getMatchingDateKey(event.start, timezone),
  ].join('|');
}

function getVisibleEventKey(event, timezone) {
  return getMatchingEventKey(event, timezone);
}

function getExistingEventKey(event, timezone) {
  return getMatchingEventKey(event, timezone);
}

function getMatchingDateKey(start, timezone) {
  if (!start) {
    return '';
  }

  if (start.date) {
    return start.date;
  }

  const dateTime = start.dateTime;
  if (!dateTime) {
    return '';
  }

  const instant = new Date(dateTime);
  if (isNaN(instant.getTime())) {
    return dateTime;
  }

  return formatInstantInTimezone(instant, timezone || 'UTC', "yyyy-MM-dd'T'HH:mm");
}

function formatInstantInTimezone(instant, timezone, pattern) {
  if (typeof Utilities !== 'undefined' && Utilities.formatDate) {
    return Utilities.formatDate(instant, timezone, pattern);
  }

  if (pattern !== "yyyy-MM-dd'T'HH:mm") {
    throw new Error('Unsupported date pattern in test fallback: ' + pattern);
  }

  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const values = {};
  formatter.formatToParts(instant).forEach(function(part) {
    values[part.type] = part.value;
  });

  return values.year + '-' + values.month + '-' + values.day + 'T' + values.hour + ':' + values.minute;
}

function getParsedDateKey(value) {
  if (!value) {
    return '';
  }
  return value.date || value.dateTime || '';
}

function getCalendarDateKey(value) {
  if (!value) {
    return '';
  }
  return value.date || value.dateTime || '';
}

function normalizeKeyPart(value) {
  return String(value)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeTitleForKey(value) {
  return normalizeKeyPart(value)
    .replace(/^\[[a-z]{2,4}\d{4}[^\]]*\]\s*/, '')
    .replace(/^[a-z]{2,4}\d{4}\s*:\s*/, '');
}

function isInSyncWindow(event, now, horizon) {
  const start = event.start.dateOnly
    ? new Date(event.start.date + 'T00:00:00Z')
    : new Date(event.start.dateTime);

  if (isNaN(start.getTime())) {
    return false;
  }

  return start >= now && start <= horizon;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function callCalendarWithRetry(operation) {
  let delayMs = 1000;

  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      return operation();
    } catch (error) {
      const message = String(error && error.message ? error.message : error);
      const retryable = message.indexOf('Rate Limit Exceeded') !== -1 || message.indexOf('Service invoked too many times') !== -1;

      if (!retryable || attempt === 6) {
        throw error;
      }

      Logger.log('Calendar API rate limit hit. Retry %s/6 after %sms.', attempt, delayMs);
      Utilities.sleep(delayMs);
      delayMs *= 2;
    }
  }
}

function findExistingMoodleEvents(calendarId, timeMin, timeMax, moodleVisibleKeys, timezone) {
  const byUid = {};
  const byKey = {};
  const duplicates = [];
  const events = [];
  let pageToken;

  do {
    const result = Calendar.Events.list(calendarId, {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      showDeleted: false,
      maxResults: 2500,
      pageToken: pageToken,
    });

    (result.items || []).forEach(function(event) {
      const description = event.description || '';
      const privateProps = event.extendedProperties && event.extendedProperties.private;
      const moodleUid = privateProps && privateProps.moodleUid;
      const match = description.match(new RegExp(SYNC_TAG + ':\\s*(.+)'));
      const uid = moodleUid || (match && match[1].trim());
      const key = getExistingEventKey(event, timezone);
      const looksLikeMoodleEvent = Boolean(uid) || Boolean(moodleVisibleKeys[key]);

      if (looksLikeMoodleEvent) {
        events.push({
          event: event,
          uid: uid || '',
          key: key,
        });
        if (uid) {
          byUid[uid] = event;
        }
        if (byKey[key]) {
          duplicates.push(event);
        } else {
          byKey[key] = event;
        }
      }
    });

    pageToken = result.nextPageToken;
  } while (pageToken);

  return {
    byUid: byUid,
    byKey: byKey,
    duplicates: duplicates,
    events: events,
  };
}

function findScriptOwnedMoodleEvents(calendarId, timeMin, timeMax) {
  const events = [];
  let pageToken;

  do {
    const result = Calendar.Events.list(calendarId, {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      showDeleted: false,
      maxResults: 2500,
      pageToken: pageToken,
    });

    (result.items || []).forEach(function(event) {
      if (isScriptOwnedMoodleEvent(event)) {
        events.push(event);
      }
    });

    pageToken = result.nextPageToken;
  } while (pageToken);

  return events;
}

function isScriptOwnedMoodleEvent(event) {
  const privateProps = event && event.extendedProperties && event.extendedProperties.private;
  return Boolean(privateProps && privateProps.source === SOURCE_NAME);
}

function shouldRemoveMissingMoodleEvent(item, moodleUids, moodleVisibleKeys, options) {
  if (item.uid && moodleUids[item.uid]) {
    return false;
  }
  if (moodleVisibleKeys[item.key]) {
    return false;
  }

  options = options || {};
  if (
    options.dataSource === DATA_SOURCE_API &&
    !options.supplementWithIcal &&
    item.uid &&
    item.uid.indexOf('api:') !== 0
  ) {
    return false;
  }

  return true;
}

function removeMissingMoodleEvents(calendarId, existingEvents, moodleUids, moodleVisibleKeys, dryRun, options) {
  let deleted = 0;

  (existingEvents || []).forEach(function(item) {
    if (!shouldRemoveMissingMoodleEvent(item, moodleUids, moodleVisibleKeys, options)) {
      return;
    }

    if (!dryRun) {
      callCalendarWithRetry(function() {
        return Calendar.Events.remove(calendarId, item.event.id);
      });
      Utilities.sleep(250);
    }
    logDryRunAction(dryRun, 'remove missing', item.event);
    deleted++;
  });

  return deleted;
}

function removeExistingMoodleEvents(calendarId, existingEvents) {
  return removeCalendarEvents(calendarId, (existingEvents || []).map(function(item) {
    return item.event;
  }), false);
}

function removeCalendarEvents(calendarId, events, dryRun) {
  let deleted = 0;

  (events || []).forEach(function(event) {
    if (!dryRun) {
      callCalendarWithRetry(function() {
        return Calendar.Events.remove(calendarId, event.id);
      });
      Utilities.sleep(250);
    }
    logDryRunAction(dryRun, 'delete synced event', event);
    deleted++;
  });

  return deleted;
}

function cleanupDuplicateSyncedEvents(calendarId, duplicates, dryRun) {
  duplicates = duplicates || [];
  let deleted = 0;

  duplicates.forEach(function(event) {
    if (!dryRun) {
      callCalendarWithRetry(function() {
        return Calendar.Events.remove(calendarId, event.id);
      });
      Utilities.sleep(250);
    }
    logDryRunAction(dryRun, 'delete duplicate', event);
    deleted++;
  });

  return deleted;
}

function logDryRunAction(dryRun, action, event) {
  if (!dryRun) {
    return;
  }

  Logger.log(
    'Dry run would %s | %s | %s',
    action,
    event.summary || 'Moodle event',
    getCalendarDateKey(event.start)
  );
}

function addDays(dateText, days) {
  const date = new Date(dateText + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    cleanModuleName,
    collectModuleNamesFromText,
    decodeIcsText,
    dedupeMoodleEvents,
    buildApiEventIndexes,
    enrichMoodleEventWithApiCourseMetadata,
    expandWeeklyOverridesToByKey,
  extractModuleCode,
    extractModuleCodeFromCourseFields,
    extractModuleName,
    countMissingModuleEvents,
    eventNeedsModuleRepair,
    formatInstantInTimezone,
    formatSyncReport,
    formatCalendarValidationError,
    formatNotificationBody,
    formatNotificationHtml,
    formatNotificationSubject,
    escapeHtml,
    formatSetupSummary,
    formatEventTitle,
    formatMoodleValidationError,
    buildNotificationItem,
    buildApiEventIndexes,
    buildMoodleApiTimesortParams,
    dateToUnixSeconds,
    getAttendanceDateKey,
    getIcalCalendarEventId,
    getMatchingDateKey,
    getMatchingEventKey,
    getEventColorId,
    getEventColorRules,
    getMoodleDataSource,
    getMoodleEventKey,
    getMoodleMatchKey,
    getMoodleUrlId,
    getNeutralMoodleMatchKey,
    getSampleNotificationItems,
    getSyncWindowBounds,
    isScriptOwnedMoodleEvent,
    learnModuleNames,
    mergeMoodleEventSources,
    normalizeMoodleApiEvent,
    normalizeKeyPart,
    normalizeTitleForKey,
    paginateMoodleApiEventPages,
    shouldRemoveMissingMoodleEvent,
    shouldShowCourseLine,
    parseIcsDate,
    parseIcsEvents,
    stripHtml,
    toQueryString,
    unfoldIcsLines,
    unixTimestampToParsedDate,
    validateJsonProperty,
  };
}
