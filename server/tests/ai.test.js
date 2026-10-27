import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSchedule, generateSchedule, recoverSchedule } from '../src/ai.js';

const slot = (id, teacherId, section, weekday, startsAt, endsAt, room='Room 1', subjectId='SUB1') => ({
  id, classGroup:'B.Tech CSE, Year 2', section, subjectId, subjectName:subjectId,
  teacherId, weekday, startsAt, endsAt, room
});

test('validator detects teacher overlap', () => {
  const result = validateSchedule([slot('a','T1','A',1,'09:00','10:00'), slot('b','T1','B',1,'09:30','10:30','Room 2','SUB2')]);
  assert.equal(result.valid, false);
  assert.ok(result.conflicts.some(c=>c.type==='teacher'));
});

test('validator detects section and room overlaps independently', () => {
  const result = validateSchedule([
    slot('a','T1','A',1,'09:00','10:00','Lab 1','SUB1'),
    slot('b','T2','A',1,'09:30','10:30','Lab 2','SUB2'),
    slot('c','T3','C',1,'09:15','10:15','Lab 1','SUB3')
  ]);
  assert.ok(result.conflicts.some(c=>c.type==='section'));
  assert.ok(result.conflicts.some(c=>c.type==='room'));
});

test('generator creates repeated weekly sessions on separate days without clashes', () => {
  const result = generateSchedule({
    requirements:[{classGroup:'B.Tech CSE, Year 2',section:'A',subjectId:'SUB1',teacherId:'T1',weeklySessions:3,durationMinutes:60,room:'Lab 1'}],
    existingSlots:[slot('fixed','T2','B',1,'09:00','10:00','Room 2','SUB2')]
  });
  assert.equal(result.ok,true,result.error);
  assert.equal(result.generated.length,3);
  assert.equal(new Set(result.generated.map(s=>s.weekday)).size,3);
  assert.equal(validateSchedule([slot('fixed','T2','B',1,'09:00','10:00','Room 2','SUB2'),...result.generated]).valid,true);
});

test('generator refuses to produce a schedule when existing data already conflicts', () => {
  const result = generateSchedule({
    requirements:[{classGroup:'CSE',section:'A',subjectId:'S',teacherId:'T1'}],
    existingSlots:[slot('a','T1','A',1,'09:00','10:00'),slot('b','T1','B',1,'09:30','10:30','Room 2','SUB2')]
  });
  assert.equal(result.ok,false);
  assert.match(result.error,/Existing timetable contains conflicts/);
});

test('recovery substitutes unavailable teacher and preserves valid schedule', () => {
  const current = [
    slot('a','T1','A',1,'09:00','10:00','Room 1','SUB1'),
    slot('b','T2','B',1,'09:00','10:00','Room 2','SUB2'),
    slot('c','T3','C',2,'09:00','10:00','Room 3','SUB3')
  ];
  const result = recoverSchedule({slots:current,disruptionType:'teacher',weekday:1,unavailableTeacherId:'T1',substituteTeacherId:'T4'});
  assert.equal(result.ok,true,result.error);
  assert.equal(result.changes.length,1);
  assert.equal(result.changes[0].teacherId,'T4');
  assert.equal(validateSchedule([...current.filter(s=>s.id!=='a'),...result.changes]).valid,true);
});

test('recovery refuses to return a plan when no substitute is supplied', () => {
  const result = recoverSchedule({slots:[slot('a','T1','A',1,'09:00','10:00')],disruptionType:'teacher',weekday:1,unavailableTeacherId:'T1'});
  assert.equal(result.ok,false);
  assert.match(result.error,/substitute teacher/i);
});

test('room recovery keeps the class time when replacement room is available', () => {
  const current = [
    slot('a','T1','A',1,'09:00','10:00','Lab 1','SUB1'),
    slot('b','T2','B',1,'09:00','10:00','Lab 2','SUB2')
  ];
  const result = recoverSchedule({slots:current,disruptionType:'room',weekday:1,unavailableRoom:'Lab 1',replacementRoom:'Lab 3'});
  assert.equal(result.ok,true,result.error);
  assert.equal(result.changes.length,1);
  assert.equal(result.changes[0].room,'Lab 3');
  assert.equal(result.changes[0].startsAt,'09:00');
  assert.equal(validateSchedule([...current.filter(s=>s.id!=='a'),...result.changes]).valid,true);
});
