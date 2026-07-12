const test = require('node:test');
const assert = require('node:assert/strict');

const {
  dedupeMoodleEvents,
  extractModuleCode,
  learnModuleNames,
  normalizeTitleForKey,
  parseIcsEvents,
  unfoldIcsLines,
} = require('../Code.js');

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
