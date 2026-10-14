import { esc, initials } from '../util.js';
import { drafts } from '../state.js';

export function hero(title, sub, extra) {
  return `<section class="hero"><div class="wrap"><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}${extra || ''}</div></section>`;
}

// Current draft value for an input, escaped for use in a value attribute or textarea.
export const val = (k) => esc(drafts[k] == null ? '' : drafts[k]);

export const avatar = (name, size) =>
  `<span class="av${size ? ' ' + size : ''}" aria-hidden="true">${esc(initials(name))}</span>`;

export const ARROW = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2 L12.5 9 H1.5 Z" fill="currentColor"/></svg>';
export const CHECK = '<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M4 10.5 8 14.5 16 5.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
