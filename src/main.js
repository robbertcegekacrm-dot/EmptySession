import './styles.css';
import { supabase, configured } from './supabase.js';
import { state, ui, drafts } from './state.js';
import { render, paint, go } from './render.js';
import { ACT, enterRoom, submitFor } from './actions.js';
import { ensureSignedIn } from './api.js';
import { loadSessions, loadMine, loadOrganizer, getSession, isMember, myProfile } from './data.js';
import { LS, toast } from './util.js';

// ---------- events ----------
function runAction(name, data, el) {
  const fn = ACT[name];
  if (!fn) return;
  const r = fn(data, el);
  if (r && r.then && el) {
    el.disabled = true;
    r.finally(() => { el.disabled = false; });
  }
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  e.preventDefault();
  runAction(b.dataset.act, { ...b.dataset }, b);
});

// Keep every keystroke in `drafts`, so re-renders never lose what someone typed.
document.addEventListener('input', (e) => {
  const k = e.target.dataset && e.target.dataset.key;
  if (k) drafts[k] = e.target.value;
});

document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (!t.dataset || e.isComposing) return;
  if (e.key === 'Enter' && t.dataset.enter && !e.shiftKey) {
    e.preventDefault();
    runAction(t.dataset.enter, { ...t.dataset });
  }
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && t.tagName === 'TEXTAREA') {
    const hit = submitFor(t.dataset.key || '');
    if (hit) { e.preventDefault(); runAction(hit[0], hit[1]); }
  }
});

// Remember whether the "Answered" list is expanded across re-renders.
document.addEventListener('toggle', (e) => {
  if (e.target.dataset && e.target.dataset.details === 'answered') ui.answeredOpen = e.target.open;
}, true);

// ---------- startup ----------
function fatal(title, text) {
  ui.fatal = { title, text };
  go('fatal');
}

// If the session someone is looking at disappears, send them back to the list.
export function checkCurrentSession() {
  if (['room', 'code', 'profile'].includes(ui.screen) && ui.sid && !getSession(ui.sid)) {
    ui.screen = 'pick';
    toast('That session was removed by the organizer.');
  }
  paint();
}

async function init() {
  if (!configured) {
    return fatal("Session Hub isn't set up yet", 'The Supabase URL and key are missing from this build. See the README.');
  }
  try {
    state.userId = await ensureSignedIn();
  } catch (e) {
    console.error(e);
    return fatal("Can't connect right now", 'Check your internet connection and reload the page. If it keeps happening, let your trainer know.');
  }
  // An expired or removed anonymous user: start fresh as a new one.
  supabase.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') location.reload(); });

  try {
    await Promise.all([loadSessions(), loadMine(), loadOrganizer()]);
  } catch (e) {
    console.error(e);
    return fatal("Can't load sessions", 'Reload the page to try again.');
  }

  const last = LS.get('hub.last', null);
  if (last && getSession(last) && (state.isOrganizer || (isMember(last) && myProfile(last)))) enterRoom(last);
  else go('pick');

  // Keep "5 min ago" labels fresh.
  setInterval(paint, 60000);
}

render();
init();
