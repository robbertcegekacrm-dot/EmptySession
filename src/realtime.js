// Live updates via Supabase Realtime.
//
// Every change event is treated as a signal to re-fetch the affected table for the current
// session (debounced), instead of patching local state from the event payload. With ~25
// people that is cheap, and it sidesteps two Realtime limitations:
//   * DELETE events can't be filtered and carry only primary keys, so we listen to them
//     unfiltered and simply re-fetch.
//   * When an organizer hides a question, participants can no longer SELECT it, so RLS stops
//     them from receiving that UPDATE. The organizer sends a broadcast "nudge" instead.
import { supabase } from './supabase.js';

const ROOM_TABLES = {
  profiles: 'profiles',
  questions: 'questions',
  question_votes: 'votes',
  prompts: 'prompts',
  prompt_answers: 'answers',
};

function batcher(fn, delay = 150) {
  const pending = new Set();
  let timer = null;
  return (item) => {
    pending.add(item);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const items = [...pending];
      pending.clear();
      fn(items);
    }, delay);
  };
}

let hubChannel = null;
export function watchSessions(onChange) {
  if (hubChannel) return;
  const nudge = batcher(onChange, 200);
  hubChannel = supabase
    .channel('hub:sessions')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, () => nudge('sessions'))
    .subscribe((status) => { if (status === 'SUBSCRIBED') nudge('sessions'); });
}

let roomChannel = null;
let roomSid = null;
export function watchRoom(sid, onParts) {
  if (roomSid === sid && roomChannel) return;
  stopRoom();
  roomSid = sid;
  const nudge = batcher(onParts);
  const ch = supabase.channel(`room:${sid}`);
  for (const [table, part] of Object.entries(ROOM_TABLES)) {
    const filter = `session_id=eq.${sid}`;
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter }, () => nudge(part));
    ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter }, () => nudge(part));
    ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, () => nudge(part));
  }
  ch.on('broadcast', { event: 'refresh' }, ({ payload }) => {
    if (payload && Object.values(ROOM_TABLES).includes(payload.part)) nudge(payload.part);
  });
  // (Re)subscribing after a dropped connection: fetch everything so nothing is missed.
  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') Object.values(ROOM_TABLES).forEach(nudge);
  });
  roomChannel = ch;
}

export function stopRoom() {
  if (roomChannel) supabase.removeChannel(roomChannel);
  roomChannel = null;
  roomSid = null;
}

// Tell everyone else in the room to re-fetch a part (used after hiding a question).
export function nudgeRoom(part) {
  if (roomChannel) roomChannel.send({ type: 'broadcast', event: 'refresh', payload: { part } });
}

// Organizers: keep people and open-question counts current on the organizer view.
let orgChannel = null;
export function watchOrganizer(onChange) {
  if (orgChannel) return;
  const nudge = batcher(onChange, 400);
  orgChannel = supabase
    .channel('org:stats')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => nudge('stats'))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'questions' }, () => nudge('stats'))
    .subscribe();
}

export function stopOrganizer() {
  if (orgChannel) supabase.removeChannel(orgChannel);
  orgChannel = null;
}
