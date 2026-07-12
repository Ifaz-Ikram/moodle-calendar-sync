const PROP_MOODLE_ICAL_URL = 'MOODLE_ICAL_URL';
const PROP_MOODLE_CALENDAR_ID = 'MOODLE_CALENDAR_ID';
const PROP_MOODLE_CALENDAR_NAME = 'MOODLE_CALENDAR_NAME';
const PROP_TIMEZONE = 'TIMEZONE';
const PROP_MODULE_OVERRIDES = 'MODULE_OVERRIDES';
const PROP_MODULE_NAMES = 'MODULE_NAMES';
const PROP_REMINDER_MINUTES = 'REMINDER_MINUTES';
const PROP_LAST_SYNC_HASH = 'LAST_SYNC_HASH';
const SYNC_TAG = 'MOODLE_SYNC_UID';
const SOURCE_NAME = 'moodle-calendar-sync';
const DEFAULT_MOODLE_CALENDAR_NAME = 'Moodle Deadlines';
const DEFAULT_REMINDER_MINUTES = [10080, 2880, 360];
const SYNC_TRIGGER_HANDLER = 'syncMoodleCalendar';
const SYNC_START_DATE = '2026-07-01';
const SYNC_END_DATE = '2028-06-30';

function syncMoodleCalendar() {
  syncMoodleCalendarInternal({ force: false, dryRun: false });
}

function forceSyncMoodleCalendar() {
  syncMoodleCalendarInternal({ force: true, dryRun: false });
}

function dryRunSyncMoodleCalendar() {
  syncMoodleCalendarInternal({ force: true, dryRun: true });
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
  const calendarId = props.getProperty(PROP_MOODLE_CALENDAR_ID) || 'primary';
  const timezone = props.getProperty(PROP_TIMEZONE) || Session.getScriptTimeZone();

  Logger.log('Validating Moodle Calendar Sync configuration...');
  validateRequiredProperty(PROP_MOODLE_ICAL_URL, icalUrl);
  validateJsonProperty(PROP_MODULE_NAMES, props.getProperty(PROP_MODULE_NAMES), 'object');
  validateJsonProperty(PROP_MODULE_OVERRIDES, props.getProperty(PROP_MODULE_OVERRIDES), 'object');
  validateJsonProperty(PROP_REMINDER_MINUTES, props.getProperty(PROP_REMINDER_MINUTES), 'array');

  const response = UrlFetchApp.fetch(icalUrl, {
    muteHttpExceptions: true,
    followRedirects: true,
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Moodle iCal fetch failed. HTTP ' + code);
  }
  const icsText = response.getContentText();
  const events = parseIcsEvents(icsText);
  Logger.log('Moodle iCal fetch OK. Parsed events: %s', events.length);

  const calendar = Calendar.Calendars.get(calendarId);
  Logger.log('Google Calendar access OK: %s (%s)', calendar.summary, calendar.id);
  Logger.log('Timezone: %s', timezone);
  Logger.log('Reminder minutes: %s', JSON.stringify(getReminderMinutes(props)));
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
  const now = new Date(SYNC_START_DATE + 'T00:00:00Z');
  const horizon = new Date(SYNC_END_DATE + 'T23:59:59Z');
  const existing = findExistingMoodleEvents('primary', now, horizon, moodleVisibleKeys);
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

function validateRequiredProperty(name, value) {
  if (!value) {
    throw new Error('Missing required Script Property: ' + name);
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
    throw new Error('Invalid JSON in Script Property ' + name + ': ' + error.message);
  }

  if (expectedType === 'array' && !Array.isArray(parsed)) {
    throw new Error('Script Property ' + name + ' must be a JSON array.');
  }

  if (expectedType === 'object' && (Array.isArray(parsed) || parsed === null || typeof parsed !== 'object')) {
    throw new Error('Script Property ' + name + ' must be a JSON object.');
  }
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

  if (!icalUrl) {
    throw new Error('Missing script property: ' + PROP_MOODLE_ICAL_URL);
  }

  const icsText = fetchIcs(icalUrl);
  const syncHash = createSyncHash(icsText, moduleOverrides, moduleNames, reminderMinutes);
  if (!force && props.getProperty(PROP_LAST_SYNC_HASH) === syncHash) {
    Logger.log('Moodle sync skipped. Feed and module configuration unchanged.');
    return;
  }

  const rawMoodleEvents = parseIcsEvents(icsText);
  const moodleEvents = dedupeMoodleEvents(rawMoodleEvents);
  const learnedModuleNames = learnModuleNames(rawMoodleEvents);
  Object.keys(learnedModuleNames).forEach(function(code) {
    if (!moduleNames[code]) {
      moduleNames[code] = learnedModuleNames[code];
    }
  });
  const moodleVisibleKeys = getMoodleVisibleKeys(moodleEvents, moduleOverrides, moduleNames, timezone);
  const moodleUids = getMoodleUids(moodleEvents);
  const now = new Date(SYNC_START_DATE + 'T00:00:00Z');
  const horizon = new Date(SYNC_END_DATE + 'T23:59:59Z');

  const existing = findExistingMoodleEvents(calendarId, now, horizon, moodleVisibleKeys);
  const existingByUid = existing.byUid;
  const existingByKey = existing.byKey;
  const duplicateDeletes = cleanupDuplicateSyncedEvents(calendarId, existing.duplicates, dryRun);
  const removedMissing = removeMissingMoodleEvents(calendarId, existing.events, moodleUids, moodleVisibleKeys, dryRun);
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let unchanged = 0;
  const handledKeys = {};

  moodleEvents.forEach(function(event) {
    if (!event.uid || !event.start) {
      return;
    }

    if (!isInSyncWindow(event, now, horizon)) {
      skipped++;
      return;
    }

    const existing = existingByUid[event.uid];
    const resource = buildCalendarResource(event, timezone, moduleOverrides, moduleNames, reminderMinutes);
    const resourceKey = getResourceKey(resource);
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
      created++;
    }
  });

  if (!dryRun) {
    props.setProperty(PROP_LAST_SYNC_HASH, syncHash);
  }
  Logger.log('%s complete. Created: %s, updated: %s, unchanged: %s, skipped: %s, deleted duplicates: %s, removed missing: %s, source events: %s, deduped events: %s', dryRun ? 'Moodle dry run' : 'Moodle sync', created, updated, unchanged, skipped, duplicateDeletes, removedMissing, rawMoodleEvents.length, moodleEvents.length);
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
  const existing = findExistingMoodleEvents(calendarId, now, horizon, moodleVisibleKeys);
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

function createSyncHash(icsText, moduleOverrides, moduleNames, reminderMinutes) {
  return createHash([
    icsText,
    JSON.stringify(moduleOverrides),
    JSON.stringify(moduleNames),
    JSON.stringify(reminderMinutes),
    SYNC_START_DATE,
    SYNC_END_DATE,
  ].join('\n'));
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

function getMoodleVisibleKeys(events, moduleOverrides, moduleNames, timezone) {
  const keys = {};
  events.forEach(function(event) {
    const resource = buildCalendarResource(event, timezone, moduleOverrides, moduleNames, DEFAULT_REMINDER_MINUTES);
    keys[getVisibleEventKey(resource)] = true;
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
  ].join('\n');

  const match = text.match(/\b[A-Z]{2,4}\s?\d{4}\b/);
  return match ? match[0].replace(/\s+/g, '') : '';
}

function extractModuleName(event, moduleCode) {
  const text = [
    event.summary || '',
    event.description || '',
    event.location || '',
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

function getResourceKey(resource) {
  return getVisibleEventKey(resource);
}

function getVisibleEventKey(event) {
  return [
    normalizeTitleForKey(event.summary || 'Moodle event'),
    getCalendarDateKey(event.start),
  ].join('|');
}

function getExistingEventKey(event) {
  return getVisibleEventKey(event);
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

function findExistingMoodleEvents(calendarId, timeMin, timeMax, moodleVisibleKeys) {
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
      const key = getExistingEventKey(event);
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

function removeMissingMoodleEvents(calendarId, existingEvents, moodleUids, moodleVisibleKeys, dryRun) {
  let deleted = 0;

  (existingEvents || []).forEach(function(item) {
    const stillExistsByUid = item.uid && moodleUids[item.uid];
    const stillExistsByKey = moodleVisibleKeys[item.key];

    if (!stillExistsByUid && !stillExistsByKey) {
      if (!dryRun) {
        callCalendarWithRetry(function() {
          return Calendar.Events.remove(calendarId, item.event.id);
        });
        Utilities.sleep(250);
      }
      logDryRunAction(dryRun, 'remove missing', item.event);
      deleted++;
    }
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
    getMoodleEventKey,
    learnModuleNames,
    normalizeKeyPart,
    normalizeTitleForKey,
    parseIcsDate,
    parseIcsEvents,
    unfoldIcsLines,
  };
}
