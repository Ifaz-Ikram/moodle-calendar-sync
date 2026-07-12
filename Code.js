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
const SYNC_TAG = 'MOODLE_SYNC_UID';
const SOURCE_NAME = 'moodle-calendar-sync';
const DEFAULT_MOODLE_CALENDAR_NAME = 'Moodle Deadlines';
const DEFAULT_MOODLE_API_BASE = 'https://online.uom.lk';
const DATA_SOURCE_API = 'api';
const DATA_SOURCE_ICAL = 'ical';
const DEFAULT_REMINDER_MINUTES = [10080, 2880, 360];
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
  Logger.log('Moodle data source: %s', dataSource);
  Logger.log('Sync trigger installed: %s', hasSyncTrigger() ? 'yes' : 'no');
  Logger.log('Configuration validation complete.');
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
    throw new Error('Script Property ' + name + ' must be a JSON array. Example: [10080,2880,360]');
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

  const source = loadMoodleEvents(props);
  const syncHash = createSyncHash(source.hashInput, moduleOverrides, moduleNames, reminderMinutes, source.source);
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
  const missingModules = countMissingModuleEvents(moodleEvents, moduleOverrides, window.start, window.end);
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
    const resource = buildCalendarResource(event, timezone, moduleOverrides, moduleNames, reminderMinutes);
    const resourceKey = getResourceKey(resource, timezone);
    const existingMatch = existing || existingByKey[resourceKey];

    if (handledKeys[resourceKey]) {
      skipped++;
      return;
    }
    handledKeys[resourceKey] = true;

    if (existingMatch) {
      if (getEventContentHash(existingMatch) === resource.extendedProperties.private.contentHash) {
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

function countMissingModuleEvents(events, moduleOverrides, now, horizon) {
  return events.filter(function(event) {
    return event.uid &&
      event.start &&
      isInSyncWindow(event, now, horizon) &&
      !extractModuleCode(event, moduleOverrides);
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
  });
  Logger.log('Notification email sent to %s for %s Moodle change(s).', email, items.length);
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

function inspectAmbiguousMoodleEvents() {
  const props = PropertiesService.getScriptProperties();
  const icalUrl = props.getProperty(PROP_MOODLE_ICAL_URL);
  const moduleOverrides = getModuleOverrides(props);

  if (!icalUrl) {
    throw new Error('Missing script property: ' + PROP_MOODLE_ICAL_URL);
  }

  const events = dedupeMoodleEvents(parseIcsEvents(fetchIcs(icalUrl)));
  events.forEach(function(event) {
    const moduleCode = extractModuleCode(event, moduleOverrides);
    if (!moduleCode) {
      Logger.log(
        'Ambiguous Moodle event | title="%s" | uid="%s" | start="%s" | description="%s"',
        event.summary || '',
        event.uid || '',
        getParsedDateKey(event.start),
        shortenForLog(event.description || '')
      );
    }
  });
}

function inspectLearnedModuleNames() {
  const props = PropertiesService.getScriptProperties();
  const icalUrl = props.getProperty(PROP_MOODLE_ICAL_URL);

  if (!icalUrl) {
    throw new Error('Missing script property: ' + PROP_MOODLE_ICAL_URL);
  }

  const names = learnModuleNames(parseIcsEvents(fetchIcs(icalUrl)));
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

function mergeMoodleEventSources(apiResult, icalResult, props) {
  const timezone = getScriptTimezone(props);
  const moduleOverrides = getModuleOverrides(props);
  const moduleNames = getModuleNames(props);
  const byKey = {};

  function addEvent(event, prefer) {
    if (!event.uid || !event.start) {
      return;
    }

    const key = getMoodleMatchKey(event, timezone, moduleOverrides, moduleNames);
    if (!byKey[key] || prefer) {
      byKey[key] = event;
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
  const apiEvents = paginateMoodleApiEventPages(function(params) {
    const payload = callMoodleApi(apiBase, token, 'core_calendar_get_action_events_by_timesort', params);
    return payload.events || [];
  }, window.start, window.end);
  return {
    source: DATA_SOURCE_API,
    hashInput: JSON.stringify(apiEvents),
    rawEvents: apiEvents.map(function(event) {
      return normalizeMoodleApiEvent(event, apiBase);
    }),
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

function createSyncHash(sourceText, moduleOverrides, moduleNames, reminderMinutes, sourceName) {
  return createHash([
    sourceName || '',
    sourceText,
    JSON.stringify(moduleOverrides),
    JSON.stringify(moduleNames),
    JSON.stringify(reminderMinutes),
    SYNC_START_DATE,
    SYNC_END_DATE,
  ].join('\n'));
}

function toQueryString(params) {
  return Object.keys(params)
    .map(function(key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
    })
    .join('&');
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
  return [
    normalizeTitleForKey(event.summary || 'Moodle event'),
    getParsedDateKey(event.start),
  ].join('|');
}

function getMoodleMatchKey(event, timezone, moduleOverrides, moduleNames) {
  const moduleCode = extractModuleCode(event, moduleOverrides);
  const moduleName = moduleCode ? moduleNames[moduleCode] || extractModuleName(event, moduleCode) : '';
  const start = event.start.dateOnly
    ? { date: event.start.date }
    : { dateTime: event.start.dateTime };

  return getMatchingEventKey({
    summary: formatEventTitle(event, moduleCode, moduleName),
    start: start,
  }, timezone);
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

function buildCalendarResource(event, timezone, moduleOverrides, moduleNames, reminderMinutes) {
  const moduleCode = extractModuleCode(event, moduleOverrides);
  const moduleName = moduleCode ? moduleNames[moduleCode] || extractModuleName(event, moduleCode) : '';
  const title = formatEventTitle(event, moduleCode, moduleName);
  const descriptionParts = [];
  if (moduleCode && moduleName) {
    descriptionParts.push('Module: ' + moduleCode + ' - ' + moduleName);
  } else if (moduleCode) {
    descriptionParts.push('Module: ' + moduleCode);
  }
  if (event.courseFullName) descriptionParts.push('Course: ' + event.courseFullName);
  if (event.description) descriptionParts.push(event.description);
  if (event.url) descriptionParts.push('Moodle: ' + event.url);

  const contentHash = createEventContentHash(event, title, moduleCode, moduleName, reminderMinutes);
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

  if (event.start.dateOnly) {
    resource.start = { date: event.start.date };
    resource.end = { date: event.end && event.end.date ? event.end.date : addDays(event.start.date, 1) };
  } else {
    resource.start = { dateTime: event.start.dateTime, timeZone: timezone };
    resource.end = { dateTime: event.end && event.end.dateTime ? event.end.dateTime : event.start.dateTime, timeZone: timezone };
  }

  return resource;
}

function createEventContentHash(event, title, moduleCode, moduleName, reminderMinutes) {
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
  const moduleLabel = moduleName ? moduleCode + ' ' + moduleName : moduleCode;
  return '[' + moduleLabel + '] ' + title;
}

function extractModuleCode(event, moduleOverrides) {
  const uidOverride = moduleOverrides.byUid[event.uid];
  if (uidOverride) {
    return uidOverride;
  }

  const titleOverride = moduleOverrides.byTitle[normalizeKeyPart(event.summary || '')];
  if (titleOverride) {
    return titleOverride;
  }

  const text = [
    event.summary || '',
    event.description || '',
    event.location || '',
    event.url || '',
    event.uid || '',
    event.courseFullName || '',
    event.courseShortName || '',
  ].join('\n');

  const match = text.match(/\b[A-Z]{2,4}\s?\d{4}\b/);
  return match ? match[0].replace(/\s+/g, '') : '';
}

function extractModuleName(event, moduleCode) {
  const text = [
    event.summary || '',
    event.description || '',
    event.location || '',
    event.courseFullName || '',
    event.courseShortName || '',
  ].join('\n');
  const escapedCode = moduleCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp('\\b' + escapedCode + '\\b\\s*[-:]?\\s*([^\\n\\r\\(]+)', 'i'));
  return match ? match[1].trim() : '';
}

function getModuleOverrides(props) {
  const raw = props.getProperty(PROP_MODULE_OVERRIDES);
  if (!raw) {
    return { byUid: {}, byTitle: {} };
  }

  const parsed = JSON.parse(raw);
  const byUid = parsed.byUid || {};
  const byTitle = {};
  Object.keys(parsed.byTitle || {}).forEach(function(title) {
    byTitle[normalizeKeyPart(title)] = parsed.byTitle[title];
  });

  return {
    byUid: byUid,
    byTitle: byTitle,
  };
}

function getModuleNames(props) {
  const raw = props.getProperty(PROP_MODULE_NAMES);
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
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
  return normalizeKeyPart(value).replace(/^\[[a-z]{2,4}\d{4}[^\]]*\]\s*/, '');
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
  let deleted = 0;

  (existingEvents || []).forEach(function(item) {
    callCalendarWithRetry(function() {
      return Calendar.Events.remove(calendarId, item.event.id);
    });
    deleted++;
    Utilities.sleep(250);
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
    extractModuleCode,
    countMissingModuleEvents,
    formatInstantInTimezone,
    formatSyncReport,
    formatCalendarValidationError,
    formatNotificationBody,
    formatNotificationSubject,
    formatMoodleValidationError,
    buildNotificationItem,
    buildMoodleApiTimesortParams,
    dateToUnixSeconds,
    getMatchingDateKey,
    getMatchingEventKey,
    getMoodleDataSource,
    getMoodleEventKey,
    getMoodleMatchKey,
    getSyncWindowBounds,
    learnModuleNames,
    mergeMoodleEventSources,
    normalizeMoodleApiEvent,
    normalizeKeyPart,
    normalizeTitleForKey,
    paginateMoodleApiEventPages,
    shouldRemoveMissingMoodleEvent,
    parseIcsDate,
    parseIcsEvents,
    stripHtml,
    unfoldIcsLines,
    unixTimestampToParsedDate,
    validateJsonProperty,
  };
}
