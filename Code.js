const PROP_MOODLE_ICAL_URL = 'MOODLE_ICAL_URL';
const PROP_MOODLE_CALENDAR_ID = 'MOODLE_CALENDAR_ID';
const PROP_TIMEZONE = 'TIMEZONE';
const PROP_MODULE_OVERRIDES = 'MODULE_OVERRIDES';
const PROP_MODULE_NAMES = 'MODULE_NAMES';
const SYNC_TAG = 'MOODLE_SYNC_UID';
const SOURCE_NAME = 'moodle-calendar-sync';
const SYNC_START_DATE = '2026-07-01';
const SYNC_END_DATE = '2028-06-30';

function syncMoodleCalendar() {
  const props = PropertiesService.getScriptProperties();
  const icalUrl = props.getProperty(PROP_MOODLE_ICAL_URL);
  const calendarId = props.getProperty(PROP_MOODLE_CALENDAR_ID) || 'primary';
  const timezone = props.getProperty(PROP_TIMEZONE) || Session.getScriptTimeZone();
  const moduleOverrides = getModuleOverrides(props);
  const moduleNames = getModuleNames(props);

  if (!icalUrl) {
    throw new Error('Missing script property: ' + PROP_MOODLE_ICAL_URL);
  }

  const icsText = fetchIcs(icalUrl);
  const rawMoodleEvents = parseIcsEvents(icsText);
  const moodleEvents = dedupeMoodleEvents(rawMoodleEvents);
  const moodleVisibleKeys = getMoodleVisibleKeys(moodleEvents, moduleOverrides, moduleNames, timezone);
  const moodleUids = getMoodleUids(moodleEvents);
  const now = new Date(SYNC_START_DATE + 'T00:00:00Z');
  const horizon = new Date(SYNC_END_DATE + 'T23:59:59Z');

  const existing = findExistingMoodleEvents(calendarId, now, horizon, moodleVisibleKeys);
  const existingByUid = existing.byUid;
  const existingByKey = existing.byKey;
  const duplicateDeletes = cleanupDuplicateSyncedEvents(calendarId, existing.duplicates);
  const removedMissing = removeMissingMoodleEvents(calendarId, existing.events, moodleUids, moodleVisibleKeys);
  let created = 0;
  let updated = 0;
  let skipped = 0;
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
    const resource = buildCalendarResource(event, timezone, moduleOverrides, moduleNames);
    const resourceKey = getResourceKey(resource);
    const existingMatch = existing || existingByKey[resourceKey];

    if (handledKeys[resourceKey]) {
      skipped++;
      return;
    }
    handledKeys[resourceKey] = true;

    if (existingMatch) {
      callCalendarWithRetry(function() {
        return Calendar.Events.update(resource, calendarId, existingMatch.id);
      });
      updated++;
      existingByKey[resourceKey] = existingMatch;
    } else {
      const inserted = callCalendarWithRetry(function() {
        return Calendar.Events.insert(resource, calendarId);
      });
      existingByKey[resourceKey] = inserted;
      created++;
    }

    Utilities.sleep(250);
  });

  Logger.log('Moodle sync complete. Created: %s, updated: %s, skipped: %s, deleted duplicates: %s, removed missing: %s, source events: %s, deduped events: %s', created, updated, skipped, duplicateDeletes, removedMissing, rawMoodleEvents.length, moodleEvents.length);
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
    const resource = buildCalendarResource(event, timezone, moduleOverrides, moduleNames);
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

function buildCalendarResource(event, timezone, moduleOverrides, moduleNames) {
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

  const resource = {
    summary: title,
    description: descriptionParts.join('\n\n'),
    location: event.location || '',
    extendedProperties: {
      private: {
        source: SOURCE_NAME,
        moodleUid: event.uid,
        moduleCode: moduleCode || '',
        moduleName: moduleName || '',
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
  return normalizeKeyPart(value).replace(/^\[[a-z]{2,4}\d{4}\]\s*/, '');
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

function removeMissingMoodleEvents(calendarId, existingEvents, moodleUids, moodleVisibleKeys) {
  let deleted = 0;

  (existingEvents || []).forEach(function(item) {
    const stillExistsByUid = item.uid && moodleUids[item.uid];
    const stillExistsByKey = moodleVisibleKeys[item.key];

    if (!stillExistsByUid && !stillExistsByKey) {
      callCalendarWithRetry(function() {
        return Calendar.Events.remove(calendarId, item.event.id);
      });
      deleted++;
      Utilities.sleep(250);
    }
  });

  return deleted;
}

function cleanupDuplicateSyncedEvents(calendarId, duplicates) {
  duplicates = duplicates || [];
  let deleted = 0;

  duplicates.forEach(function(event) {
    callCalendarWithRetry(function() {
      return Calendar.Events.remove(calendarId, event.id);
    });
    deleted++;
    Utilities.sleep(250);
  });

  return deleted;
}

function addDays(dateText, days) {
  const date = new Date(dateText + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}
