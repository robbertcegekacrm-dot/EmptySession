import { esc } from '../util.js';
import { ui } from '../state.js';
import { hero } from './common.js';
import { pick } from './pick.js';
import { code } from './code.js';
import { profile } from './profile.js';
import { room } from './room.js';
import { admin } from './admin.js';
import { orgcode } from './orgcode.js';

export const SCREENS = {
  loading: () => ({ main: '<p class="muted">Loading sessions</p>' }),
  fatal: () => ({ hero: hero(esc(ui.fatal?.title || "Session Hub can't load"), esc(ui.fatal?.text || 'Reload the page to try again.')), main: '' }),
  pick, code, profile, room, admin, orgcode,
};
