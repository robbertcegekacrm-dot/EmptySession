// Data loaded from Supabase. Only data.js writes to this; views read it.
export const state = {
  userId: null,
  isOrganizer: false,
  sessions: [],            // { id, title, session_date, is_open }
  sessionsLoaded: false,
  memberOf: new Set(),     // session ids I joined
  myProfiles: [],          // my intros across sessions, newest first
  room: emptyRoom(null),
  codes: {},               // organizer only: session id -> plaintext join code
  stats: {},               // organizer only: session id -> { people, open_questions }
};

export function emptyRoom(sid) {
  return { sid, profiles: [], questions: [], votes: [], prompts: [], answers: [] };
}

// UI state (screen, open panels, errors).
export const ui = {
  screen: 'loading', sid: null, tab: 'intros',
  codeError: '', profileError: '', orgError: '',
  editCode: null, confirmDel: null, answering: null, answeredOpen: false,
  fatal: null,
};

// What people are typing, keyed by the input's data-key. Survives every re-render.
export const drafts = {};
