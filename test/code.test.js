const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildNotificationItem,
  countMissingModuleEvents,
  dedupeMoodleEvents,
  extractModuleCode,
  formatNotificationBody,
  formatNotificationSubject,
  formatSyncReport,
  formatCalendarValidationError,
  formatMoodleValidationError,
  getMoodleDataSource,
  learnModuleNames,
  normalizeMoodleApiEvent,
  normalizeTitleForKey,
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

test('normalizeTitleForKey ignores existing module prefixes', () => {
  assert.equal(
    normalizeTitleForKey('[CS3501 Data Science and Engineering Project] Attendance'),
    'attendance'
  );
  assert.equal(
    normalizeTitleForKey('[CS3501] Attendance'),
    'attendance'
  );
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
