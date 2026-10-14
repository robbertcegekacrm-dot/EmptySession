import { esc, fmtDate, plural, genCode } from '../util.js';
import { ui, state, drafts } from '../state.js';
import { hero, val } from './common.js';
import { pick } from './pick.js';

export function admin() {
  if (!state.isOrganizer) return pick();
  if (drafts.ns_code == null) drafts.ns_code = genCode();

  const list = [...state.sessions].sort((a, b) =>
    (b.session_date || '').localeCompare(a.session_date || '') || (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));

  const rows = list.map((s) => {
    const id = esc(s.id);
    const st = state.stats[s.id] || { people: 0, open_questions: 0 };
    let extra = '';
    if (ui.editCode === s.id) {
      extra = `<div class="inline"><label class="sr" for="cc_${id}">New code</label><input id="cc_${id}" data-key="cc_${id}" data-enter="saveCodeFor" data-sid="${id}" maxlength="12" autocomplete="off" value="${val('cc_' + s.id)}"><button class="btn ghost small" data-act="genCodeFor" data-sid="${id}">Generate</button><button class="btn primary small" data-act="saveCodeFor" data-sid="${id}">Save code</button><button class="btn link" data-act="cancelCode">Cancel</button></div>`;
    }
    if (ui.confirmDel === s.id) {
      extra = `<div class="inline" role="alert"><span>Delete this session for everyone? All intros, questions and answers are removed for good.</span><button class="btn danger small" data-act="doDelete" data-sid="${id}">Delete session</button><button class="btn link" data-act="cancelDelete">Keep it</button></div>`;
    }
    return `<div class="arow">
      <div class="stitle">${esc(s.title)}</div><div class="sdate">${esc(fmtDate(s.session_date))}</div>
      <div class="ameta">${s.is_open ? '<span class="chip live">Open for joining</span>' : '<span class="chip off">Closed</span>'}<span>Code <b>${esc(state.codes[s.id] || '…')}</b></span><span>${plural(st.people, 'person', 'people')}</span><span>${plural(st.open_questions, 'open question', 'open questions')}</span></div>
      <div class="row"><button class="btn primary small" data-act="enter" data-sid="${id}">Open room</button><button class="btn ghost small" data-act="toggleOpen" data-sid="${id}">${s.is_open ? 'Close joining' : 'Open joining'}</button><button class="btn ghost small" data-act="editCode" data-sid="${id}">Change code</button><button class="btn link" data-act="askDelete" data-sid="${id}">Delete</button></div>
      ${extra}
    </div>`;
  }).join('');

  return {
    hero: hero('Organizer view', "Create a session, then share this page's link and the session code with participants. Run introductions, questions and group prompts from the session room."),
    main: `<div class="cols">
      <section class="panel"><h2>New session</h2>
        <div class="field"><label for="ns_title">Title</label><input id="ns_title" data-key="ns_title" maxlength="90" value="${val('ns_title')}"></div>
        <div class="field"><label for="ns_date">Date</label><input id="ns_date" type="date" data-key="ns_date" value="${val('ns_date')}"></div>
        <div class="field"><label for="ns_code">Join code</label><p class="hint">4 to 12 letters or digits, not case-sensitive. Share it when the session starts.</p>
          <div class="inline" style="margin-top:0"><input id="ns_code" data-key="ns_code" maxlength="12" autocomplete="off" value="${val('ns_code')}"><button class="btn ghost small" data-act="genCode">Generate</button></div></div>
        <button class="btn primary" data-act="createSession">Create session</button>
      </section>
      <section><h2>Sessions</h2>${rows || '<p class="empty">Sessions you create show up here.</p>'}</section>
    </div>`,
  };
}
