import { randomUUID } from 'node:crypto';
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function timeToMinutes(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value.slice(0, 5))) return NaN;
  const [h, m] = value.slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}
function minutesToTime(value) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
function norm(slot) {
  return {
    ...slot,
    weekday: Number(slot.weekday),
    startsAt: String(slot.startsAt).slice(0, 5),
    endsAt: String(slot.endsAt).slice(0, 5),
    teacherId: String(slot.teacherId || ""),
    classGroup: String(slot.classGroup || "").trim(),
    section: String(slot.section || "").trim().toUpperCase(),
    room: String(slot.room || "").trim().toLowerCase()
  };
}
function overlaps(a, b) {
  return a.weekday === b.weekday &&
    timeToMinutes(a.startsAt) < timeToMinutes(b.endsAt) &&
    timeToMinutes(a.endsAt) > timeToMinutes(b.startsAt);
}
function conflictsBetween(a, b) {
  if (!overlaps(a, b)) return [];
  const found = [];
  if (a.teacherId && a.teacherId === b.teacherId) found.push("teacher");
  if (a.classGroup.trim().toLowerCase() === b.classGroup.trim().toLowerCase() && a.section.toUpperCase() === b.section.toUpperCase()) found.push("section");
  if (a.room && a.room.trim().toLowerCase() === b.room.trim().toLowerCase()) found.push("room");
  return found;
}
export function validateSchedule(input) {
  const slots = (Array.isArray(input) ? input : []).map(norm);
  const conflicts = [];
  for (let i = 0; i < slots.length; i++) {
    const a = slots[i];
    if (!Number.isInteger(a.weekday) || a.weekday < 0 || a.weekday > 6 ||
        !Number.isFinite(timeToMinutes(a.startsAt)) || !Number.isFinite(timeToMinutes(a.endsAt)) ||
        timeToMinutes(a.startsAt) >= timeToMinutes(a.endsAt)) {
      conflicts.push({ type: "invalid-slot", slotIds: [a.id || `slot-${i + 1}`], message: "Invalid day or time range." });
      continue;
    }
    for (let j = i + 1; j < slots.length; j++) {
      const b = slots[j];
      const kinds = conflictsBetween(a, b);
      for (const type of kinds) conflicts.push({
        type,
        slotIds: [a.id || `slot-${i + 1}`, b.id || `slot-${j + 1}`],
        weekday: a.weekday,
        message: type === "teacher" ? "Teacher is assigned to overlapping classes." :
          type === "section" ? "The same section has overlapping classes." : "Room is double-booked."
      });
    }
  }
  return { valid: conflicts.length === 0, conflictCount: conflicts.length, conflicts };
}
const GRID = [9*60, 10*60, 11*60, 13*60, 14*60, 15*60, 16*60];
function fits(candidate, occupied) {
  return occupied.every(other => conflictsBetween(candidate, other).length === 0);
}
function placementScore(candidate, requirement, dayCounts) {
  let score = dayCounts[candidate.weekday] || 0;
  if (candidate.weekday === 0 || candidate.weekday === 6) score += 20;
  if (candidate.startsAt === "09:00") score -= 0.1;
  return score;
}
export function generateSchedule({ requirements, existingSlots = [], days = [1,2,3,4,5], maxNodes = 50000 }) {
  if (!Array.isArray(requirements) || requirements.length < 1 || requirements.length > 40) {
    return { ok: false, error: "Provide between 1 and 40 class requirements." };
  }
  const tasks = [];
  for (const r of requirements) {
    if (!r || !r.classGroup || !r.section || !r.subjectId || !r.teacherId) {
      return { ok: false, error: "Every requirement needs classGroup, section, subjectId and teacherId." };
    }
    const count = Number(r.weeklySessions ?? 1);
    const duration = Number(r.durationMinutes ?? 60);
    if (!Number.isInteger(count) || count < 1 || count > 6 || ![30,60,90,120].includes(duration)) {
      return { ok: false, error: "weeklySessions must be 1–6 and durationMinutes must be 30, 60, 90 or 120." };
    }
    for (let n = 0; n < count; n++) tasks.push({ ...r, weeklySessions: count, durationMinutes: duration, occurrence: n + 1 });
  }
  const normalizedDays = [...new Set(days.map(Number))].filter(d => Number.isInteger(d) && d >= 1 && d <= 5);
  if (!normalizedDays.length) return { ok: false, error: "Choose at least one weekday (Monday–Friday)." };
  const occupied = existingSlots.map(norm);
  const conflicts = validateSchedule(occupied);
  if (!conflicts.valid) return { ok: false, error: "Existing timetable contains conflicts. Resolve them before generating more classes.", conflicts: conflicts.conflicts };
  const candidatesFor = task => {
    const arr = [];
    for (const day of normalizedDays) {
      for (const start of GRID) {
        const end = start + task.durationMinutes;
        if (end > 17*60 || (start < 13*60 && end > 12*60)) continue;
        arr.push({
          id: `AI-${randomUUID()}`.slice(0, 80),
          classGroup: task.classGroup, section: task.section, subjectId: task.subjectId,
          subjectName: task.subjectName || task.subjectId, teacherId: task.teacherId,
          weekday: day, startsAt: minutesToTime(start), endsAt: minutesToTime(end),
          room: task.room || "", generated: true, occurrence: task.occurrence
        });
      }
    }
    return arr;
  };
  const expanded = tasks.map(task => ({ task, candidates: candidatesFor(task) }))
    .sort((a,b) => a.candidates.length - b.candidates.length || b.task.durationMinutes-a.task.durationMinutes);
  if (expanded.some(x => !x.candidates.length)) return { ok: false, error: "No valid time slots exist for one or more requirements." };
  const picked = [];
  let nodes = 0;
  const dayCounts = {};
  function solve(index) {
    if (index >= expanded.length) return true;
    if (++nodes > maxNodes) return false;
    const item = expanded[index];
    const options = item.candidates.slice().sort((a,b) => placementScore(a,item.task,dayCounts)-placementScore(b,item.task,dayCounts));
    for (const candidate of options) {
      // Avoid putting repeated weekly sessions of the same subject into the same day when alternatives exist.
      const sameSubjectSameDay = [...occupied, ...picked].some(x =>
        x.weekday === candidate.weekday && x.section === candidate.section &&
        x.classGroup.toLowerCase() === candidate.classGroup.toLowerCase() && x.subjectId === candidate.subjectId);
      if (sameSubjectSameDay && normalizedDays.length > 1) continue;
      if (!fits(candidate, [...occupied, ...picked])) continue;
      picked.push(candidate); dayCounts[candidate.weekday] = (dayCounts[candidate.weekday] || 0) + 1;
      if (solve(index + 1)) return true;
      picked.pop(); dayCounts[candidate.weekday]--;
    }
    return false;
  }
  if (!solve(0)) return { ok: false, error: nodes > maxNodes ? "Search limit reached. Reduce requirements or add more available days/time slots." : "No valid timetable satisfies all hard constraints. Add capacity or change requirements.", nodes };
  const validation = validateSchedule([...occupied, ...picked]);
  if (!validation.valid) return { ok: false, error: "Internal validation failed; schedule was not returned.", conflicts: validation.conflicts };
  return { ok: true, generated: picked, validation, nodes, score: picked.length };
}

export function recoverSchedule({ slots, disruptionType, weekday, unavailableTeacherId, substituteTeacherId, unavailableRoom, replacementRoom }) {
  if (!Array.isArray(slots) || !slots.length) return { ok: false, error: "No timetable entries were supplied." };
  const all = slots.map(norm);
  const currentValidation = validateSchedule(all);
  if (!currentValidation.valid) return { ok: false, error: "The current timetable already has conflicts. Resolve those first.", conflicts: currentValidation.conflicts };
  const day = Number(weekday);
  const affected = all.filter(s => s.weekday === day && (
    disruptionType === "teacher" ? s.teacherId === unavailableTeacherId :
    disruptionType === "room" ? s.room === String(unavailableRoom || "").trim().toLowerCase() : false
  ));
  if (!affected.length) return { ok: false, error: "No timetable entries match this disruption and weekday." };
  if (disruptionType === "teacher" && (!substituteTeacherId || substituteTeacherId === unavailableTeacherId)) return { ok: false, error: "Choose a different substitute teacher." };
  if (disruptionType === "room" && !String(replacementRoom || "").trim()) return { ok: false, error: "Enter an available replacement room." };
  const affectedIds = new Set(affected.map(s => s.id));
  const occupied = all.filter(s => !affectedIds.has(s.id));
  const moved = [];
  for (const original of affected) {
    const candidateBase = { ...original };
    if (disruptionType === "teacher") candidateBase.teacherId = substituteTeacherId;
    if (disruptionType === "room") candidateBase.room = String(replacementRoom).trim();
    const duration = timeToMinutes(original.endsAt) - timeToMinutes(original.startsAt);
    const options = [];
    for (let d=1; d<=5; d++) for (const start of GRID) {
      const end = start + duration;
      if (end > 17*60 || (start < 13*60 && end > 12*60)) continue;
      const c = { ...candidateBase, weekday: d, startsAt: minutesToTime(start), endsAt: minutesToTime(end) };
      const dayPenalty = d === original.weekday ? 0 : 100;
      const timePenalty = Math.abs(start - timeToMinutes(original.startsAt)) / 10;
      options.push({ c, score: dayPenalty + timePenalty });
    }
    options.sort((a,b) => a.score-b.score);
    const choice = options.find(x => fits(x.c, [...occupied, ...moved]));
    if (!choice) return { ok: false, error: `Could not find a valid alternative for ${original.subjectName || original.subjectId}. No timetable was changed.`, affectedCount: affected.length };
    moved.push({ ...choice.c, id: `REC-${original.id}`.slice(0,80), replacesId: original.id, original: {
      weekday: original.weekday, startsAt: original.startsAt, endsAt: original.endsAt,
      teacherId: original.teacherId, room: original.room
    }});
  }
  const preview = [...occupied, ...moved];
  const validation = validateSchedule(preview);
  if (!validation.valid) return { ok: false, error: "Recovery proposal failed validation; no changes should be applied.", conflicts: validation.conflicts };
  const changed = moved.filter(m => m.weekday !== all.find(s=>s.id===m.replacesId).weekday ||
    m.startsAt !== all.find(s=>s.id===m.replacesId).startsAt ||
    m.endsAt !== all.find(s=>s.id===m.replacesId).endsAt ||
    m.teacherId !== all.find(s=>s.id===m.replacesId).teacherId ||
    m.room !== all.find(s=>s.id===m.replacesId).room);
  return { ok: true, affectedCount: affected.length, changes: changed, validation, explanation: "Proposed changes preserve all unaffected classes and were checked for teacher, section and room overlap. Review before applying." };
}
export { DAY_NAMES };
