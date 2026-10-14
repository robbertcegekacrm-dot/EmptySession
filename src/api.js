// Thin wrappers around Supabase calls. Each one throws on error and returns plain data.
// Access control lives in the database (RLS + SECURITY DEFINER functions), not here.
import { supabase } from './supabase.js';

async function run(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}
const rpc = (fn, args) => run(supabase.rpc(fn, args));

// ---------- auth ----------
export async function ensureSignedIn() {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) return session.user.id;
  const data = await run(supabase.auth.signInAnonymously());
  return data.user.id;
}

// ---------- reads ----------
export const listSessions = () =>
  run(supabase.from('sessions').select('id, title, session_date, is_open, created_at'));

export const listMyMemberships = (uid) =>
  run(supabase.from('session_members').select('session_id').eq('user_id', uid));

export const listMyProfiles = (uid) =>
  run(supabase.from('profiles').select('*').eq('user_id', uid).order('updated_at', { ascending: false }));

const ROOM_QUERIES = {
  profiles: (sid) => supabase.from('profiles').select('*').eq('session_id', sid).order('created_at'),
  questions: (sid) => supabase.from('questions').select('*').eq('session_id', sid).eq('hidden', false),
  votes: (sid) => supabase.from('question_votes').select('question_id, user_id').eq('session_id', sid),
  prompts: (sid) => supabase.from('prompts').select('*').eq('session_id', sid).order('created_at', { ascending: false }),
  answers: (sid) => supabase.from('prompt_answers').select('*').eq('session_id', sid).order('created_at'),
};
export const ROOM_PARTS = Object.keys(ROOM_QUERIES);
export const loadRoomPart = (part, sid) => run(ROOM_QUERIES[part](sid));

export const isOrganizer = () => rpc('is_organizer');
export const listCodes = () => run(supabase.from('session_secrets').select('session_id, code_plain'));
export const sessionStats = () => rpc('session_stats');

// ---------- participant writes ----------
export const joinSession = (sid, code) => rpc('join_session', { p_session_id: sid, p_code: code });

// user_id is filled in by the database (default auth.uid()); RLS rejects anyone else's row.
export function saveProfile(sid, uid, fields, exists) {
  return exists
    ? run(supabase.from('profiles').update(fields).eq('session_id', sid).eq('user_id', uid))
    : run(supabase.from('profiles').insert({ session_id: sid, ...fields }));
}

export const askQuestion = (sid, text) => run(supabase.from('questions').insert({ session_id: sid, text }));
export const deleteQuestion = (qid) => run(supabase.from('questions').delete().eq('id', qid));
export const addVote = (sid, qid) => run(supabase.from('question_votes').insert({ session_id: sid, question_id: qid }));
export const removeVote = (qid, uid) =>
  run(supabase.from('question_votes').delete().eq('question_id', qid).eq('user_id', uid));

export function saveAnswer(sid, pid, uid, text, exists) {
  return exists
    ? run(supabase.from('prompt_answers').update({ text }).eq('prompt_id', pid).eq('user_id', uid))
    : run(supabase.from('prompt_answers').insert({ session_id: sid, prompt_id: pid, text }));
}

// ---------- organizer ----------
export const unlockOrganizer = (code) => rpc('unlock_organizer', { p_code: code });
export const lockOrganizer = () => rpc('lock_organizer');
export const createSession = (title, date, code) =>
  rpc('create_session', { p_title: title, p_date: date || null, p_code: code });
export const setSessionCode = (sid, code) => rpc('set_session_code', { p_session_id: sid, p_code: code });
export const setSessionOpen = (sid, open) => rpc('set_session_open', { p_session_id: sid, p_open: open });
export const deleteSession = (sid) => rpc('delete_session', { p_session_id: sid });
export const moderateQuestion = (qid, { answered = null, hidden = null, answer = null }) =>
  rpc('moderate_question', { p_question_id: qid, p_answered: answered, p_hidden: hidden, p_answer_text: answer });

export const postPrompt = (sid, text) => run(supabase.from('prompts').insert({ session_id: sid, text }));
export const setPromptOpen = (pid, open) => run(supabase.from('prompts').update({ is_open: open }).eq('id', pid));
export const deletePrompt = (pid) => run(supabase.from('prompts').delete().eq('id', pid));
