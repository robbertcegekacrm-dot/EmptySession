// Loads data from Supabase into `state` and schedules a re-render.
import * as api from './api.js';
import { state, emptyRoom } from './state.js';
import { paint } from './render.js';

export async function loadSessions() {
  state.sessions = await api.listSessions();
  state.sessionsLoaded = true;
  paint();
}

export async function loadMine() {
  const [members, profiles] = await Promise.all([
    api.listMyMemberships(state.userId),
    api.listMyProfiles(state.userId),
  ]);
  state.memberOf = new Set(members.map((m) => m.session_id));
  state.myProfiles = profiles;
  paint();
}

export async function loadOrganizer() {
  state.isOrganizer = await api.isOrganizer();
  if (state.isOrganizer) await loadOrganizerData();
  paint();
}

export async function loadOrganizerData() {
  if (!state.isOrganizer) return;
  const [codes, stats] = await Promise.all([api.listCodes(), api.sessionStats()]);
  state.codes = Object.fromEntries(codes.map((c) => [c.session_id, c.code_plain]));
  state.stats = Object.fromEntries(stats.map((s) => [s.session_id, s]));
  paint();
}

export function setRoom(sid) {
  if (state.room.sid !== sid) state.room = emptyRoom(sid);
}

// Reload some or all parts of the current room (profiles, questions, votes, prompts, answers).
export async function loadRoom(parts = api.ROOM_PARTS) {
  const sid = state.room.sid;
  if (!sid) return;
  const results = await Promise.all(parts.map((p) => api.loadRoomPart(p, sid)));
  if (state.room.sid !== sid) return; // switched rooms while loading
  parts.forEach((p, i) => { state.room[p] = results[i]; });
  paint();
}

// ---------- selectors used by the views ----------
export const getSession = (sid) => state.sessions.find((s) => s.id === sid) || null;
export const isMember = (sid) => state.memberOf.has(sid);
export const myProfile = (sid) => state.myProfiles.find((p) => p.session_id === sid) || null;
export const latestProfile = () => state.myProfiles[0] || null;

export function nameOf(uid) {
  const p = state.room.profiles.find((x) => x.user_id === uid);
  return (p && p.name) || 'Someone';
}

export function roomQuestions() {
  const counts = new Map();
  const mine = new Set();
  for (const v of state.room.votes) {
    counts.set(v.question_id, (counts.get(v.question_id) || 0) + 1);
    if (v.user_id === state.userId) mine.add(v.question_id);
  }
  return state.room.questions.map((q) => ({ ...q, votes: counts.get(q.id) || 0, voted: mine.has(q.id) }));
}

export const answersFor = (pid) => state.room.answers.filter((a) => a.prompt_id === pid);
export const myAnswer = (pid) =>
  state.room.answers.find((a) => a.prompt_id === pid && a.user_id === state.userId) || null;
