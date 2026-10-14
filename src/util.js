export const $ = (s) => document.querySelector(s);

export const esc = (s) =>
  String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

// No 0/O or 1/I so codes are easy to read out loud.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function genCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('on'), 3600);
}

export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s + 'T00:00:00');
  if (isNaN(d)) return s;
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

export function ago(iso) {
  if (!iso) return '';
  const ts = Date.parse(iso);
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' h ago';
  return new Date(ts).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export const initials = (n) =>
  (n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

export const plural = (n, a, b) => n + ' ' + (n === 1 ? a : b);

// Turn a Supabase/PostgREST error into a sentence a participant can act on.
export function friendlyError(e) {
  const msg = (e && e.message) || '';
  if (/Organizer access required/i.test(msg)) return 'Your organizer access has ended. Open the organizer view again.';
  if (/join code of 4 to 12/i.test(msg)) return 'Use a join code of 4 to 12 letters or digits.';
  if (e && e.code === '23514') return "That's too long or empty. Shorten it and try again.";
  if (e && (e.code === '42501' || /row-level security/i.test(msg))) return "You can't change that. If you just joined, reload the page.";
  if (/fetch|network/i.test(msg)) return "That didn't save. Check your connection and try again.";
  return "That didn't save. Try again in a moment.";
}
