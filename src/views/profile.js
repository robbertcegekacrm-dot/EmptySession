import { esc } from '../util.js';
import { ui, state } from '../state.js';
import { getSession, myProfile } from '../data.js';
import { hero, val } from './common.js';
import { pick } from './pick.js';

export function profile() {
  const s = getSession(ui.sid);
  if (!s) return pick();
  const has = myProfile(ui.sid);
  return {
    hero: hero(esc(s.title), 'Introduce yourself to the group. Everyone in this session sees your intro.'),
    main: `<div class="panel narrow">
      <h2>${has ? 'Edit your intro' : 'Your intro'}</h2>
      <p class="privacy">Everyone in this session can see your intro. The organizer deletes the session's data after the training.</p>
      <div class="field"><label for="p_name">Name</label><input id="p_name" data-key="p_name" maxlength="60" autocomplete="name" required aria-required="true" value="${val('p_name')}"></div>
      <div class="field"><label for="p_role">What do you do?</label><p class="hint">Your role or the kind of work you do</p><input id="p_role" data-key="p_role" maxlength="80" value="${val('p_role')}"></div>
      <div class="field"><label for="p_org">Where do you work?</label><input id="p_org" data-key="p_org" maxlength="80" autocomplete="organization" value="${val('p_org')}"></div>
      <div class="field"><label for="p_goal">What are you hoping to get out of this session?</label><textarea id="p_goal" data-key="p_goal" maxlength="400">${val('p_goal')}</textarea></div>
      ${ui.profileError ? `<p class="error" role="alert">${esc(ui.profileError)}</p>` : ''}
      <div class="row"><button class="btn primary" data-act="saveProfile">${has ? 'Save changes' : 'Save and enter'}</button>${has || state.isOrganizer ? '<button class="btn link" data-act="enterCurrent">Cancel</button>' : ''}</div>
    </div>`,
  };
}
