import { esc, fmtDate } from '../util.js';
import { state } from '../state.js';
import { isMember } from '../data.js';
import { hero } from './common.js';

export function pick() {
  const byDate = (a, b) => (a.session_date || '').localeCompare(b.session_date || '');
  const open = state.sessions.filter((s) => s.is_open).sort(byDate);
  const joinedClosed = state.sessions.filter((s) => !s.is_open && isMember(s.id)).sort(byDate);

  const row = (s) => `<button class="srow" data-act="choose" data-sid="${esc(s.id)}">
      <span class="stitle">${esc(s.title)}</span>
      <span class="sdate">${esc(fmtDate(s.session_date)) || '&nbsp;'}</span>
      <span class="sside">${isMember(s.id) ? '<span class="chip">Joined</span>' : 'Enter code'}</span>
    </button>`;

  let main;
  if (!state.sessionsLoaded) {
    main = '<p class="muted">Loading sessions</p>';
  } else if (!open.length && !joinedClosed.length) {
    main = `<p class="empty">${state.isOrganizer
      ? 'No sessions yet. Create one in the organizer view.'
      : 'No sessions are open right now. Your trainer opens the session shortly before it starts.'}</p>`;
  } else {
    main = `<div class="sessions">${open.map(row).join('')}</div>`;
    if (joinedClosed.length) {
      main += `<p class="group-title">Earlier sessions you joined</p><div class="sessions">${joinedClosed.map(row).join('')}</div>`;
    }
  }
  return { hero: hero('Join your session', "Pick the training you're attending, then enter the code your trainer shared."), main };
}
