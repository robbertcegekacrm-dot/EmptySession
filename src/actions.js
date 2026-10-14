// Click / Enter handlers, looked up by data-act (see main.js).
import * as api from './api.js';
import { state, ui, drafts } from './state.js';
import { render, go } from './render.js';
import { LS, toast, genCode, friendlyError } from './util.js';
import { watchRoom, stopRoom, nudgeRoom, watchOrganizer, stopOrganizer } from './realtime.js';
import {
  loadSessions, loadMine, loadOrganizer, loadOrganizerData, loadRoom, setRoom,
  getSession, isMember, myProfile, latestProfile, myAnswer, roomQuestions,
} from './data.js';

// Run a write; on failure show a friendly toast. Returns true on success.
async function attempt(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
    return true;
  } catch (e) {
    console.error(e);
    toast(friendlyError(e));
    if (/Organizer access required/i.test(e?.message || '')) loadOrganizer().catch(() => {});
    return false;
  }
}

export function enterRoom(sid) {
  ui.sid = sid;
  ui.tab = 'intros';
  ui.answering = null;
  LS.set('hub.last', sid);
  setRoom(sid);
  go('room');
  loadRoom().catch((e) => toast(friendlyError(e)));
  watchRoom(sid, (parts) => loadRoom(parts).catch(() => {}));
}

function goProfile(sid) {
  ui.sid = sid;
  ui.profileError = '';
  const own = myProfile(sid);
  const p = own || latestProfile();
  drafts.p_name = p?.name || '';
  drafts.p_role = p?.role || '';
  drafts.p_org = p?.org || '';
  drafts.p_goal = own ? (own.goal || '') : ''; // goals are per session
  go('profile');
}

export const ACT = {
  home() { stopRoom(); ui.codeError = ''; go('pick'); },

  admin() {
    stopRoom();
    if (state.isOrganizer) { go('admin'); loadOrganizerData().catch(() => {}); }
    else { ui.orgError = ''; go('orgcode'); }
  },

  choose({ sid }) {
    ui.sid = sid;
    if (state.isOrganizer || (isMember(sid) && myProfile(sid))) return enterRoom(sid);
    if (isMember(sid)) return goProfile(sid);
    ui.codeError = '';
    drafts.code = '';
    go('code');
  },

  async join() {
    const code = (drafts.code || '').trim();
    if (!code) { ui.codeError = 'Enter the code your trainer shared.'; return render(); }
    let status;
    try { status = await api.joinSession(ui.sid, code); }
    catch (e) { ui.codeError = friendlyError(e); return render(); }
    const messages = {
      wrong_code: "That code doesn't match this session. Check it with your trainer.",
      closed: "This session isn't open for joining right now. Check with your trainer.",
      rate_limited: 'Too many tries. Wait a few minutes and try again.',
      not_found: 'This session no longer exists.',
    };
    if (status !== 'ok') { ui.codeError = messages[status] || "Couldn't join. Try again."; return render(); }
    ui.codeError = '';
    drafts.code = '';
    await loadMine();
    if (myProfile(ui.sid)) enterRoom(ui.sid); else goProfile(ui.sid);
  },

  editProfile() { goProfile(ui.sid); },
  enterCurrent() { enterRoom(ui.sid); },

  async saveProfile() {
    const name = (drafts.p_name || '').trim();
    if (!name) { ui.profileError = 'Add your name so the group knows who you are.'; return render(); }
    const prev = myProfile(ui.sid);
    const fields = {
      name,
      role: (drafts.p_role || '').trim(),
      org: (drafts.p_org || '').trim(),
      goal: (drafts.p_goal || '').trim(),
    };
    const ok = await attempt(async () => {
      // Organizers can enter rooms without joining; they join (no code needed) to post an intro.
      if (!isMember(ui.sid)) {
        const status = await api.joinSession(ui.sid, null);
        if (status !== 'ok') throw new Error('join failed: ' + status);
      }
      await api.saveProfile(ui.sid, state.userId, fields, !!prev);
      await loadMine();
    }, prev ? 'Intro updated' : 'Welcome in');
    if (ok) enterRoom(ui.sid);
  },

  tab({ tab }) { ui.tab = tab; render(); },

  async ask() {
    const text = (drafts.q_new || '').trim();
    if (!text) return toast('Type your question first.');
    if (await attempt(() => api.askQuestion(ui.sid, text), 'Question posted')) {
      drafts.q_new = '';
      render();
      loadRoom(['questions']);
    }
  },

  async vote({ qid }) {
    const q = roomQuestions().find((x) => x.id === qid);
    if (!q) return;
    await attempt(() => (q.voted ? api.removeVote(qid, state.userId) : api.addVote(ui.sid, qid)));
    loadRoom(['votes']);
  },

  async markQ({ qid, val }) {
    const answered = val === '1';
    if (await attempt(() => api.moderateQuestion(qid, { answered }), answered ? 'Marked answered' : 'Reopened')) loadRoom(['questions']);
  },

  async removeQ({ qid, mine }) {
    const ok = await attempt(() => (mine ? api.deleteQuestion(qid) : api.moderateQuestion(qid, { hidden: true })), 'Question removed');
    if (ok) {
      // Participants can't SELECT a hidden question, so RLS keeps the UPDATE event from
      // reaching them. Nudge their clients to re-fetch instead.
      if (!mine) nudgeRoom('questions');
      loadRoom(['questions']);
    }
  },

  startReply({ qid }) {
    ui.answering = qid;
    render();
    document.getElementById('r_' + qid)?.focus();
  },
  cancelReply() { ui.answering = null; render(); },

  async postReply({ qid }) {
    const text = (drafts['r_' + qid] ?? document.getElementById('r_' + qid)?.value ?? '').trim();
    if (!text) return toast('Type the answer first.');
    if (await attempt(() => api.moderateQuestion(qid, { answered: true, answer: text }), 'Answer posted')) {
      delete drafts['r_' + qid];
      ui.answering = null;
      render();
      loadRoom(['questions']);
    }
  },

  async unlockOrg() {
    const code = drafts.orgc || '';
    if (!code.trim()) { ui.orgError = 'Enter the organizer code.'; return render(); }
    let status;
    try { status = await api.unlockOrganizer(code); }
    catch (e) { ui.orgError = friendlyError(e); return render(); }
    const messages = {
      wrong_code: "That code isn't right.",
      rate_limited: 'Too many tries. Wait a few minutes and try again.',
      not_configured: "The organizer code hasn't been set up yet. See the README.",
    };
    if (status !== 'ok') { ui.orgError = messages[status] || "Couldn't unlock. Try again."; return render(); }
    ui.orgError = '';
    drafts.orgc = '';
    await loadOrganizer();
    watchOrganizer(() => loadOrganizerData().catch(() => {}));
    go('admin');
  },

  async lockOrg() {
    if (await attempt(() => api.lockOrganizer(), 'Organizer view locked')) {
      state.isOrganizer = false;
      state.codes = {};
      state.stats = {};
      stopOrganizer();
      go('pick');
    }
  },

  async postPrompt() {
    const text = (drafts.pr_new || '').trim();
    if (!text) return toast('Type a question for the group first.');
    if (await attempt(() => api.postPrompt(ui.sid, text), 'Posted to the group')) {
      drafts.pr_new = '';
      render();
      loadRoom(['prompts']);
    }
  },

  async answer({ pid }) {
    const k = 'a_' + pid;
    const text = (drafts[k] ?? '').trim();
    if (!text) return toast('Type your answer first.');
    const mine = myAnswer(pid);
    if (await attempt(() => api.saveAnswer(ui.sid, pid, state.userId, text, !!mine), 'Answer shared')) {
      delete drafts[k];
      loadRoom(['answers']);
    }
  },

  async togglePrompt({ pid, val }) {
    const open = val === '1';
    if (await attempt(() => api.setPromptOpen(pid, open), open ? 'Answers reopened' : 'Answers closed')) loadRoom(['prompts']);
  },

  async deletePrompt({ pid }) {
    if (await attempt(() => api.deletePrompt(pid), 'Deleted')) loadRoom(['prompts', 'answers']);
  },

  // ---------- organizer view ----------
  genCode() { drafts.ns_code = genCode(); render(); },

  async createSession() {
    const title = (drafts.ns_title || '').trim();
    const date = drafts.ns_date || '';
    const code = (drafts.ns_code || '').trim().toUpperCase();
    if (!title) return toast('Give the session a title.');
    if (!/^[A-Z0-9]{4,12}$/.test(code)) return toast('Use a join code of 4 to 12 letters or digits.');
    if (await attempt(() => api.createSession(title, date, code), 'Session created')) {
      drafts.ns_title = '';
      drafts.ns_date = '';
      drafts.ns_code = genCode();
      await refreshOrganizer();
    }
  },

  enter({ sid }) { enterRoom(sid); },

  async toggleOpen({ sid }) {
    const s = getSession(sid);
    if (!s) return;
    if (await attempt(() => api.setSessionOpen(sid, !s.is_open), s.is_open ? 'Closed for new joiners' : 'Open for joining')) await refreshOrganizer();
  },

  editCode({ sid }) { ui.editCode = sid; ui.confirmDel = null; drafts['cc_' + sid] = state.codes[sid] || ''; render(); },
  genCodeFor({ sid }) { drafts['cc_' + sid] = genCode(); render(); },
  cancelCode() { ui.editCode = null; render(); },

  async saveCodeFor({ sid }) {
    const code = (drafts['cc_' + sid] || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(code)) return toast('Use a join code of 4 to 12 letters or digits.');
    if (await attempt(() => api.setSessionCode(sid, code), 'Code updated')) {
      ui.editCode = null;
      await refreshOrganizer();
    }
  },

  askDelete({ sid }) { ui.confirmDel = sid; ui.editCode = null; render(); },
  cancelDelete() { ui.confirmDel = null; render(); },

  async doDelete({ sid }) {
    if (await attempt(() => api.deleteSession(sid), 'Session deleted')) {
      ui.confirmDel = null;
      await refreshOrganizer();
    }
  },
};

async function refreshOrganizer() {
  await Promise.all([loadSessions(), loadOrganizerData()]).catch(() => {});
}

// Ctrl/Cmd+Enter in a textarea submits it.
export function submitFor(key) {
  if (key === 'q_new') return ['ask', {}];
  if (key === 'pr_new') return ['postPrompt', {}];
  if (key === 'p_goal') return ['saveProfile', {}];
  if (key.startsWith('a_')) return ['answer', { pid: key.slice(2) }];
  if (key.startsWith('r_')) return ['postReply', { qid: key.slice(2) }];
  return null;
}
