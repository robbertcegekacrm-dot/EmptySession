import { esc, fmtDate } from '../util.js';
import { ui } from '../state.js';
import { getSession } from '../data.js';
import { hero, val } from './common.js';
import { pick } from './pick.js';

export function code() {
  const s = getSession(ui.sid);
  if (!s) return pick();
  return {
    hero: hero(esc(s.title), esc(fmtDate(s.session_date))),
    main: `<div class="panel narrow">
      <label for="code">Session code</label>
      <p class="hint">Your trainer shares this code at the start of the session.</p>
      <input id="code" class="code-in" data-key="code" data-enter="join" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="12" value="${val('code')}">
      ${ui.codeError ? `<p class="error" role="alert">${esc(ui.codeError)}</p>` : ''}
      <div class="row"><button class="btn primary" data-act="join">Join session</button><button class="btn link" data-act="home">Back to sessions</button></div>
    </div>`,
  };
}
