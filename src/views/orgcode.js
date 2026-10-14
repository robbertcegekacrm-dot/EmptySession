import { esc } from '../util.js';
import { ui } from '../state.js';
import { hero, val } from './common.js';

export function orgcode() {
  return {
    hero: hero('Organizer view', 'Enter the organizer code to create sessions, post questions to the group and answer questions.'),
    main: `<div class="panel narrow">
      <label for="orgc">Organizer code</label>
      <input id="orgc" class="code-in" type="password" data-key="orgc" data-enter="unlockOrg" autocomplete="off" spellcheck="false" maxlength="100" value="${val('orgc')}">
      ${ui.orgError ? `<p class="error" role="alert">${esc(ui.orgError)}</p>` : ''}
      <div class="row"><button class="btn primary" data-act="unlockOrg">Open organizer view</button><button class="btn link" data-act="home">Back to sessions</button></div>
    </div>`,
  };
}
