import { $ } from './util.js';
import { ui } from './state.js';
import { SCREENS } from './views/index.js';

// Batch re-renders to one per animation frame; data loads call this freely.
let queued = false;
export function paint() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; render(); });
}

// Full re-render via innerHTML. Typed text lives in `drafts` (see main.js), and the focused
// field plus its cursor position are restored by data-key, so live updates never interrupt
// someone who is typing.
export function render() {
  const a = document.activeElement;
  const fk = a && a.dataset ? a.dataset.key : null;
  let ss = null, se = null;
  try { ss = a.selectionStart; se = a.selectionEnd; } catch { /* not a text field */ }

  const v = (SCREENS[ui.screen] || SCREENS.pick)();
  $('#hero').innerHTML = v.hero || '';
  $('#main').innerHTML = v.main || '';
  $('#topActions').innerHTML = topActions();

  if (fk) {
    const el = document.querySelector(`[data-key="${CSS.escape(fk)}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      try { if (ss != null) el.setSelectionRange(ss, se); } catch { /* not a text field */ }
    }
  }
}

export function go(screen) {
  ui.screen = screen;
  render();
  window.scrollTo(0, 0);
}

function topActions() {
  if (['loading', 'fatal'].includes(ui.screen)) return '';
  if (ui.screen === 'admin') {
    return `<div class="row" style="margin:0"><button class="btn ghost small" data-act="home">Participant view</button><button class="btn link" data-act="lockOrg">Lock</button></div>`;
  }
  if (ui.screen === 'orgcode') return `<button class="btn ghost small" data-act="home">Participant view</button>`;
  return `<button class="btn ghost small" data-act="admin">Organizer view</button>`;
}
