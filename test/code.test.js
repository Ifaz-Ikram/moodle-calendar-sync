const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMoodleApiTimesortParams,
  buildNotificationItem,
  countMissingModuleEvents,
  dateToUnixSeconds,
  dedupeMoodleEvents,
  buildApiEventIndexes,
  enrichMoodleEventWithApiCourseMetadata,
  extractModuleCode,
  extractModuleCodeFromCourseFields,
  extractModuleName,
  formatNotificationBody,
  formatNotificationSubject,
  formatEventTitle,
  formatSyncReport,
  formatCalendarValidationError,
  formatMoodleValidationError,
  getEventColorId,
  getEventColorRules,
  getMatchingDateKey,
  getMatchingEventKey,
  getMoodleDataSource,
  getMoodleUrlId,
  getSyncWindowBounds,
  isScriptOwnedMoodleEvent,
  learnModuleNames,
  mergeMoodleEventSources,
  normalizeMoodleApiEvent,
  normalizeTitleForKey,
  paginateMoodleApiEventPages,
  shouldRemoveMissingMoodleEvent,
  shouldShowCourseLine,
  parseIcsEvents,
  stripHtml,
  unfoldIcsLines,
  validateJsonProperty,
} = require('../Code.js');

function mockProps(values) {
  return {
    getProperty(name) {
      return values[name];
    },
  };
}

test('unfoldIcsLines joins folded iCal lines', () => {
  const lines = unfoldIcsLines('SUMMARY:Long Moodle\n title\nDESCRIPTION:first\n second');

  assert.deepEqual(lines, [
    'SUMMARY:Long Moodletitle',
    'DESCRIPTION:firstsecond',
  ]);
});

test('parseIcsEvents extracts Moodle event fields', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:abc123@online.uom.lk',
    'SUMMARY:Answer Submission\\, Part 1 is due',
    'DESCRIPTION:Line one\\nLine two',
    'LOCATION:Online',
    'URL:https://online.uom.lk/mod/assign/view.php?id=1',
    'DTSTART:20260711T183000Z',
    'DTEND:20260711T193000Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n');

  const events = parseIcsEvents(ics);

  assert.equal(events.length, 1);
  assert.equal(events[0].uid, 'abc123@online.uom.lk');
  assert.equal(events[0].summary, 'Answer Submission, Part 1 is due');
  assert.equal(events[0].description, 'Line one\nLine two');
  assert.equal(events[0].location, 'Online');
  assert.deepEqual(events[0].start, {
    dateTime: '2026-07-11T18:30:00Z',
    dateOnly: false,
  });
});

test('parseIcsEvents handles all-day date values', () => {
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:day@online.uom.lk',
    'SUMMARY:All day',
    'DTSTART;VALUE=DATE:20260712',
    'DTEND;VALUE=DATE:20260713',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n');

  const [event] = parseIcsEvents(ics);

  assert.deepEqual(event.start, {
    date: '2026-07-12',
    dateOnly: true,
  });
});

test('dedupeMoodleEvents collapses visible duplicate source events', () => {
  const events = [
    {
      uid: 'one@online.uom.lk',
      summary: 'Self Assessment 01 closes',
      description: '',
      start: { dateTime: '2026-07-12T07:30:00Z', dateOnly: false },
    },
    {
      uid: 'two@online.uom.lk',
      summary: 'Self Assessment 01 closes',
      description: 'More detailed description',
      start: { dateTime: '2026-07-12T07:30:00Z', dateOnly: false },
    },
  ];

  const deduped = dedupeMoodleEvents(events);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].uid, 'two@online.uom.lk');
});

test('learnModuleNames extracts module names from Moodle-style titles', () => {
  const names = learnModuleNames([
    { summary: 'CS3621 Data Mining (L)' },
    { description: 'In23-S5-MA3024 - Numerical Methods' },
    { summary: 'CS3631 Deep Neural Networks (P) - Dr. Sandareka' },
  ]);

  assert.equal(names.CS3621, 'Data Mining');
  assert.equal(names.MA3024, 'Numerical Methods');
  assert.equal(names.CS3631, 'Deep Neural Networks');
});

test('extractModuleCode prefers byUid and byTitle overrides', () => {
  const overrides = {
    byUid: {
      '6822664@online.uom.lk': 'CS3501',
    },
    byTitle: {
      [normalizeTitleForKey('Answer Submission for Additional Questions is due')]: 'MN3043',
    },
  };

  assert.equal(
    extractModuleCode({ uid: '6822664@online.uom.lk', summary: 'Attendance' }, overrides),
    'CS3501'
  );
  assert.equal(
    extractModuleCode({ uid: 'other@online.uom.lk', summary: 'Answer Submission for Additional Questions is due' }, overrides),
    'MN3043'
  );
});

test('extractModuleCode prefers Moodle course metadata over byTitle overrides', () => {
  const overrides = {
    byUid: {},
    byTitle: {
      'project proposal - pdf submission is due': 'CS3880',
    },
  };
  const event = {
    uid: 'api:551637@online.uom.lk',
    summary: 'Project Proposal - PDF Submission is due',
    courseFullName: 'In23-S5-CS3631 - Deep Neural Networks',
    courseShortName: 'In23-S5-CS3631 (33105)',
  };

  assert.equal(extractModuleCode(event, overrides), 'CS3631');
});

test('extractModuleCode prefers Moodle course metadata over unrelated description codes', () => {
  const event = {
    uid: 'api:551639@online.uom.lk',
    summary: 'Short-Paper Submission is due',
    description: 'Please submit a PDF version of your short paper for CS3880 Engineer and Society.',
    courseFullName: 'In23-S5-CS3631 - Deep Neural Networks',
    courseShortName: 'In23-S5-CS3631 (33105)',
  };

  assert.equal(extractModuleCode(event, { byUid: {}, byTitle: {} }), 'CS3631');
  assert.equal(extractModuleName(event, 'CS3631'), 'Deep Neural Networks');
});

test('shouldShowCourseLine hides redundant course metadata when module already matches', () => {
  const event = {
    courseFullName: 'In23-S5-CS3631 - Deep Neural Networks',
    courseShortName: 'In23-S5-CS3631 (33105)',
  };

  assert.equal(shouldShowCourseLine('CS3631', 'Deep Neural Networks', event), false);
  assert.equal(shouldShowCourseLine('CS3631', '', event), false);
});

test('shouldShowCourseLine keeps full course label when module metadata is incomplete', () => {
  const event = {
    courseFullName: 'In23-S5-CS3631 - Deep Neural Networks',
    courseShortName: 'In23-S5-CS3631 (33105)',
  };

  assert.equal(shouldShowCourseLine('', '', event), true);
});

test('normalizeTitleForKey ignores existing module prefixes', () => {
  assert.equal(
    normalizeTitleForKey('[CS3501 Data Science and Engineering Project] Attendance'),
    'attendance'
  );
  assert.equal(
    normalizeTitleForKey('[CS3501] Attendance'),
    'attendance'
  );
  assert.equal(
    normalizeTitleForKey('CS3501: Attendance'),
    'attendance'
  );
});

test('formatEventTitle uses concise module code prefixes', () => {
  assert.equal(
    formatEventTitle({ summary: 'Attendance' }, 'CS3501', 'Data Science and Engineering Project'),
    'CS3501: Attendance'
  );
  assert.equal(
    formatEventTitle({ summary: 'CS3501 Attendance' }, 'CS3501', 'Data Science and Engineering Project'),
    'CS3501 Attendance'
  );
});

test('getEventColorId applies default keyword rules', () => {
  assert.equal(
    getEventColorId({ summary: 'Spot Quiz 02 closes' }, '', getEventColorRules(mockProps({}))),
    '5'
  );
  assert.equal(
    getEventColorId({ summary: 'Attendance' }, '', getEventColorRules(mockProps({}))),
    '7'
  );
});

test('getEventColorId prefers module and event type rules before keywords', () => {
  const rules = getEventColorRules(mockProps({
    EVENT_COLOR_RULES: JSON.stringify({
      byModule: { CS3501: '9' },
      byEventType: { due: '4' },
      byKeyword: { quiz: '5' },
    }),
  }));

  assert.equal(getEventColorId({ summary: 'Quiz', eventType: 'due' }, 'CS3501', rules), '9');
  assert.equal(getEventColorId({ summary: 'Quiz', eventType: 'due' }, '', rules), '4');
  assert.equal(getEventColorId({ summary: 'Quiz', eventType: '' }, '', rules), '5');
});

test('getEventColorId ignores invalid color ids', () => {
  const rules = getEventColorRules(mockProps({
    EVENT_COLOR_RULES: JSON.stringify({
      byKeyword: { quiz: '99' },
    }),
  }));

  assert.equal(getEventColorId({ summary: 'Quiz' }, '', rules), '');
});

test('isScriptOwnedMoodleEvent only matches hidden source metadata', () => {
  assert.equal(isScriptOwnedMoodleEvent({
    extendedProperties: {
      private: {
        source: 'moodle-calendar-sync',
      },
    },
  }), true);

  assert.equal(isScriptOwnedMoodleEvent({
    description: 'MOODLE_SYNC_UID: abc@online.uom.lk',
  }), false);
});

test('normalizeMoodleApiEvent maps Moodle API course fields', () => {
  const event = normalizeMoodleApiEvent({
    id: 6779111,
    name: 'About me (Questionnaire Opens)',
    description: '<p>About me</p>',
    timestart: 1737966600,
    timeduration: 3600,
    url: 'https://online.uom.lk/mod/questionnaire/view.php?id=445181',
    course: {
      id: 27059,
      fullname: 'In23-S3-CS2953 - Communication Skills',
      shortname: 'In23-S3-CS2953 (124337)',
    },
  }, 'https://online.uom.lk');

  assert.equal(event.uid, 'api:6779111@online.uom.lk');
  assert.equal(event.summary, 'About me (Questionnaire Opens)');
  assert.equal(event.description, 'About me');
  assert.equal(event.courseFullName, 'In23-S3-CS2953 - Communication Skills');
  assert.equal(event.courseShortName, 'In23-S3-CS2953 (124337)');
  assert.equal(event.start.dateTime, '2025-01-27T08:30:00Z');
  assert.equal(event.end.dateTime, '2025-01-27T09:30:00Z');
});

test('API course fields allow automatic module extraction and learning', () => {
  const event = {
    uid: 'api:1@online.uom.lk',
    summary: 'Attendance',
    courseFullName: 'In23-S5-MN3043 - Business Economics and Financial Accounting',
    courseShortName: 'In23-S5-MN3043 (33105)',
  };

  assert.equal(extractModuleCode(event, { byUid: {}, byTitle: {} }), 'MN3043');
  assert.equal(
    learnModuleNames([event]).MN3043,
    'Business Economics and Financial Accounting'
  );
});

test('stripHtml removes tags and decodes common entities', () => {
  assert.equal(stripHtml('<p>A&amp;B &lt; C</p>'), 'A&B < C');
});

test('getMoodleDataSource defaults to API when token exists', () => {
  assert.equal(getMoodleDataSource(mockProps({ MOODLE_TOKEN: 'token' })), 'api');
  assert.equal(getMoodleDataSource(mockProps({})), 'ical');
  assert.equal(getMoodleDataSource(mockProps({ MOODLE_DATA_SOURCE: 'ical', MOODLE_TOKEN: 'token' })), 'ical');
});

test('validateJsonProperty reports actionable JSON errors', () => {
  assert.throws(
    () => validateJsonProperty('MODULE_NAMES', '[', 'object'),
    /Fix the value in Apps Script/
  );
  assert.throws(
    () => validateJsonProperty('REMINDER_MINUTES', '{"bad":true}', 'array'),
    /Example: \[10080,2880,360\]/
  );
});

test('validation error formatters include setup hints', () => {
  assert.match(
    formatMoodleValidationError('api', new Error('invalidtoken')),
    /Check MOODLE_API_BASE and MOODLE_TOKEN/
  );
  assert.match(
    formatCalendarValidationError('primary', new Error('not found')),
    /Enable Services -> Google Calendar API/
  );
});

test('formatSyncReport includes operational sync counts', () => {
  const report = formatSyncReport({
    title: 'Moodle sync complete',
    source: 'api',
    calendarId: 'calendar-id',
    dryRun: false,
    triggerInstalled: true,
    created: 1,
    updated: 2,
    unchanged: 3,
    skipped: 4,
    deletedDuplicates: 5,
    removedMissing: 6,
    sourceEvents: 7,
    dedupedEvents: 8,
    missingModules: 9,
  });

  assert.match(report, /Source: api/);
  assert.match(report, /Created: 1/);
  assert.match(report, /Events missing module: 9/);
  assert.match(report, /Hourly trigger installed: yes/);
});

test('countMissingModuleEvents counts only in-window events without module codes', () => {
  const now = new Date('2026-07-01T00:00:00Z');
  const horizon = new Date('2028-06-30T23:59:59Z');
  const events = [
    { uid: '1', summary: 'Attendance', start: { dateTime: '2026-07-12T10:00:00Z', dateOnly: false } },
    { uid: '2', summary: 'CS3501 Attendance', start: { dateTime: '2026-07-12T10:00:00Z', dateOnly: false } },
    { uid: '3', summary: 'Attendance', start: { dateTime: '2029-07-12T10:00:00Z', dateOnly: false } },
  ];

  assert.equal(countMissingModuleEvents(events, { byUid: {}, byTitle: {} }, now, horizon), 1);
});

test('notification formatters summarize Moodle changes', () => {
  const items = [
    {
      action: 'New',
      title: '[MA3024 Numerical Methods] Spot Quiz',
      when: 'Tue, 7 Jul 2026, 3:00 PM',
      moduleCode: 'MA3024',
      moduleName: 'Numerical Methods',
    },
    {
      action: 'Updated',
      title: '[CS3501] Attendance',
      when: 'Thu, 9 Jul 2026, 10:15 AM',
      moduleCode: 'CS3501',
      moduleName: '',
    },
  ];

  assert.equal(formatNotificationSubject(items), 'Moodle Calendar: 2 deadline changes');
  assert.match(formatNotificationBody(items), /New: \[MA3024 Numerical Methods\] Spot Quiz/);
  assert.match(formatNotificationBody(items), /Module: MA3024 - Numerical Methods/);
});

test('buildNotificationItem reads module metadata from calendar resource', () => {
  const item = buildNotificationItem('New', {
    summary: '[MN3043] Self Assessment 01 closes',
    start: { date: '2026-07-12' },
    extendedProperties: {
      private: {
        moduleCode: 'MN3043',
        moduleName: 'Business Economics and Financial Accounting',
      },
    },
  }, 'Asia/Colombo');

  assert.equal(item.action, 'New');
  assert.equal(item.when, '2026-07-12');
  assert.equal(item.moduleCode, 'MN3043');
});

test('getSyncWindowBounds matches configured sync dates', () => {
  const window = getSyncWindowBounds();

  assert.equal(window.start.toISOString(), '2026-07-01T00:00:00.000Z');
  assert.equal(window.end.toISOString(), '2028-06-30T23:59:59.000Z');
});

test('buildMoodleApiTimesortParams requests the full sync window', () => {
  const window = getSyncWindowBounds();
  const params = buildMoodleApiTimesortParams(window.start, window.end);

  assert.equal(params.timesortfrom, dateToUnixSeconds(window.start));
  assert.equal(params.timesortto, dateToUnixSeconds(window.end));
  assert.equal(params.limitnum, 50);
});

test('paginateMoodleApiEventPages fetches additional pages until the window is exhausted', () => {
  const window = getSyncWindowBounds();
  const calls = [];
  const events = paginateMoodleApiEventPages(function(params) {
    calls.push(Object.assign({}, params));

    if (!params.aftereventid) {
      return Array.from({ length: 50 }, function(_, index) {
        return { id: index + 1, name: 'Event ' + (index + 1) };
      });
    }

    if (params.aftereventid === 50) {
      return [
        { id: 51, name: 'Event 51' },
        { id: 52, name: 'Event 52' },
      ];
    }

    return [];
  }, window.start, window.end);

  assert.equal(events.length, 52);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].aftereventid, undefined);
  assert.equal(calls[1].aftereventid, 50);
});

test('paginateMoodleApiEventPages deduplicates overlapping event ids', () => {
  const window = getSyncWindowBounds();
  const events = paginateMoodleApiEventPages(function() {
    return [
      { id: 1, name: 'First' },
      { id: 1, name: 'Duplicate' },
      { id: 2, name: 'Second' },
    ];
  }, window.start, window.end);

  assert.deepEqual(events.map(function(event) { return event.id; }), [1, 2]);
});

test('getMatchingDateKey treats equivalent instants in a timezone as the same key', () => {
  const timezone = 'Asia/Colombo';
  const utcKey = getMatchingDateKey({ dateTime: '2026-07-13T18:29:00Z' }, timezone);
  const localKey = getMatchingDateKey({ dateTime: '2026-07-13T23:59:00+05:30' }, timezone);

  assert.equal(utcKey, localKey);
});

test('getMatchingEventKey matches API and Google Calendar title/date variants', () => {
  const timezone = 'Asia/Colombo';
  const apiStyle = getMatchingEventKey({
    summary: '[CS3621 Data Mining] Pattern Mining Assignment closes',
    start: { dateTime: '2026-07-13T18:29:00Z' },
  }, timezone);
  const calendarStyle = getMatchingEventKey({
    summary: '[CS3621 Data Mining] Pattern Mining Assignment closes',
    start: { dateTime: '2026-07-13T23:59:00+05:30' },
  }, timezone);

  assert.equal(apiStyle, calendarStyle);
});

test('enrichMoodleEventWithApiCourseMetadata copies Moodle API course fields onto matching iCal events', () => {
  const timezone = 'Asia/Colombo';
  const apiIndexes = buildApiEventIndexes([{
    uid: 'api:551637@online.uom.lk',
    summary: 'Project Proposal - PDF Submission is due',
    start: { dateTime: '2026-08-14T18:29:00Z', dateOnly: false },
    courseFullName: 'In23-S5-CS3631 - Deep Neural Networks',
    courseShortName: 'In23-S5-CS3631 (33105)',
    url: 'https://online.uom.lk/mod/assign/view.php?id=551637',
  }], timezone);

  const enriched = enrichMoodleEventWithApiCourseMetadata({
    uid: 'ical@online.uom.lk',
    summary: 'Project Proposal - PDF Submission is due',
    description: 'Please submit the project proposal as a PDF here for CS3880 Engineer and Society.',
    start: { dateTime: '2026-08-14T23:59:00+05:30', dateOnly: false },
    url: 'https://online.uom.lk/mod/assign/view.php?id=551637',
  }, apiIndexes, timezone);

  assert.equal(extractModuleCode(enriched, { byUid: {}, byTitle: {} }), 'CS3631');
  assert.equal(extractModuleName(enriched, 'CS3631'), 'Deep Neural Networks');
});

test('mergeMoodleEventSources deduplicates API and iCal events before module titles are applied', () => {
  const props = mockProps({
    TIMEZONE: 'Asia/Colombo',
    MODULE_NAMES: '{"CS3631":"Deep Neural Networks","CS3880":"Engineer and Society"}',
  });
  const apiResult = {
    hashInput: 'api',
    rawEvents: [{
      uid: 'api:551637@online.uom.lk',
      summary: 'Project Proposal - PDF Submission is due',
      start: { dateTime: '2026-08-14T18:29:00Z', dateOnly: false },
      courseFullName: 'In23-S5-CS3631 - Deep Neural Networks',
      courseShortName: 'In23-S5-CS3631 (33105)',
      url: 'https://online.uom.lk/mod/assign/view.php?id=551637',
    }],
  };
  const icalResult = {
    hashInput: 'ical',
    rawEvents: [{
      uid: 'ical@online.uom.lk',
      summary: 'Project Proposal - PDF Submission is due',
      description: 'Please submit the project proposal as a PDF here for CS3880 Engineer and Society.',
      start: { dateTime: '2026-08-14T23:59:00+05:30', dateOnly: false },
      url: 'https://online.uom.lk/mod/assign/view.php?id=551637',
    }],
  };
  const merged = mergeMoodleEventSources(apiResult, icalResult, props);

  assert.equal(merged.rawEvents.length, 1);
  assert.equal(merged.rawEvents[0].uid, 'api:551637@online.uom.lk');
  assert.equal(extractModuleCode(merged.rawEvents[0], { byUid: {}, byTitle: {} }), 'CS3631');
});

test('mergeMoodleEventSources prefers API events and keeps iCal-only events', () => {
  const props = mockProps({
    TIMEZONE: 'Asia/Colombo',
    MODULE_NAMES: '{"CS3621":"Data Mining","CS3501":"Data Science and Engineering Project"}',
  });
  const apiResult = {
    hashInput: 'api',
    rawEvents: [{
      uid: 'api:1@online.uom.lk',
      summary: 'Pattern Mining Assignment closes',
      start: { dateTime: '2026-07-13T18:29:00Z', dateOnly: false },
      courseShortName: 'In23-S5-CS3621',
    }],
  };
  const icalResult = {
    hashInput: 'ical',
    rawEvents: [
      {
        uid: 'one@online.uom.lk',
        summary: 'Pattern Mining Assignment closes',
        start: { dateTime: '2026-07-13T23:59:00+05:30', dateOnly: false },
      },
      {
        uid: 'two@online.uom.lk',
        summary: 'Attendance',
        start: { dateTime: '2026-07-10T18:30:00Z', dateOnly: false },
        courseFullName: 'In23-S5-CS3501 - Data Science and Engineering Project',
      },
    ],
  };
  const merged = mergeMoodleEventSources(apiResult, icalResult, props);

  assert.equal(merged.rawEvents.length, 2);
  assert.equal(merged.rawEvents.some(function(event) { return event.uid === 'api:1@online.uom.lk'; }), true);
  assert.equal(merged.rawEvents.some(function(event) { return event.summary === 'Attendance'; }), true);
});

test('shouldRemoveMissingMoodleEvent keeps iCal-synced events during API-only sync', () => {
  assert.equal(
    shouldRemoveMissingMoodleEvent(
      { uid: 'abc@online.uom.lk', key: 'attendance|2026-07-10T00:00' },
      {},
      {},
      { dataSource: 'api', supplementWithIcal: false }
    ),
    false
  );
  assert.equal(
    shouldRemoveMissingMoodleEvent(
      { uid: 'api:99@online.uom.lk', key: 'old assignment|2026-07-01T23:59' },
      {},
      {},
      { dataSource: 'api', supplementWithIcal: true }
    ),
    true
  );
});
