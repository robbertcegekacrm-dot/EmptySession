import { esc, fmtDate, ago, plural } from '../util.js';
import { ui, state, drafts } from '../state.js';
import { getSession, isMember, myProfile, nameOf, roomQuestions, answersFor, myAnswer } from '../data.js';
import { hero, val, avatar, ARROW, CHECK } from './common.js';
import { pick } from './pick.js';

export function room() {
  const sid = ui.sid;
  const s = getSession(sid);
  if (!s) return pick();
  const { profiles, prompts } = state.room;
  const qs = roomQuestions();
  const mp = myProfile(sid);
  const member = isMember(sid);
  const openQ = qs.filter((q) => !q.answered);

  const extra = `<div class="meta"><span>${plural(profiles.length, 'person', 'people')} introduced</span><span>${plural(openQ.length, 'open question', 'open questions')}</span>${!s.is_open ? '<span>Closed for new joiners</span>' : ''}</div>
    <div class="actions"><button class="btn dark small" data-act="editProfile">${mp ? 'Edit my intro' : 'Add my intro'}</button><button class="btn ghost small" data-act="home">All sessions</button></div>`;

  let main = '';
  const live = member && prompts.find((p) => p.is_open && !myAnswer(p.id));
  if (live && ui.tab !== 'prompts') {
    main += `<div class="banner" role="status"><p><span>Your trainer asked</span>${esc(live.text)}</p><button class="btn primary small" data-act="tab" data-tab="prompts">Answer</button></div>`;
  }
  const tabs = [['intros', 'Introductions', profiles.length], ['questions', 'Questions', openQ.length], ['prompts', 'From the trainers', prompts.length]];
  main += `<div class="tabs" role="tablist">${tabs.map(([k, l, n]) =>
    `<button class="tab" role="tab" aria-selected="${ui.tab === k}" data-act="tab" data-tab="${k}">${l}<span class="n">${n}</span></button>`).join('')}</div>`;
  main += `<div role="tabpanel">`;
  if (ui.tab === 'intros') main += introsHTML(mp);
  else if (ui.tab === 'questions') main += questionsHTML(qs, member);
  else main += promptsHTML(member);
  main += `</div>`;

  return { hero: hero(esc(s.title), esc(fmtDate(s.session_date)), extra), main };
}

function introsHTML(mp) {
  let h = '';
  if (!mp && state.isOrganizer) {
    h += `<p class="note">You're here as organizer. <button class="btn link" data-act="editProfile">Add your own intro</button> if you'd like the group to see it.</p>`;
  }
  const pr = state.room.profiles;
  if (!pr.length) return h + `<p class="empty">No one has introduced themselves yet.</p>`;
  h += `<div class="grid">` + pr.map((p) => {
    const role = p.role && p.org ? `${esc(p.role)} at ${esc(p.org)}` : esc(p.role || p.org || '');
    const mine = p.user_id === state.userId;
    return `<article class="card${mine ? ' me' : ''}"><div class="who">${avatar(p.name)}<div><div class="name">${esc(p.name)} ${mine ? '<span class="chip">You</span>' : ''}</div>${role ? `<div class="role">${role}</div>` : ''}</div></div>
      ${p.goal ? `<p class="goal"><b>Hoping to get</b>${esc(p.goal)}</p>` : ''}</article>`;
  }).join('') + `</div>`;
  return h;
}

function questionsHTML(qs, member) {
  const org = state.isOrganizer;
  const t = (iso) => Date.parse(iso) || 0;
  const open = qs.filter((q) => !q.answered).sort((a, b) => b.votes - a.votes || t(a.created_at) - t(b.created_at));
  const done = qs.filter((q) => q.answered).sort((a, b) => t(b.answered_at || b.created_at) - t(a.answered_at || a.created_at));

  const qrow = (q) => {
    const mine = q.user_id === state.userId;
    const acts = [];
    if (org) acts.push(`<button class="btn link" data-act="startReply" data-qid="${esc(q.id)}">${q.answer_text ? 'Edit answer' : 'Write answer'}</button>`);
    if (org) acts.push(`<button class="btn link" data-act="markQ" data-qid="${esc(q.id)}" data-val="${q.answered ? '0' : '1'}">${q.answered ? 'Reopen' : 'Mark answered'}</button>`);
    if (mine || org) acts.push(`<button class="btn link" data-act="removeQ" data-qid="${esc(q.id)}" data-mine="${mine ? '1' : ''}">Remove</button>`);
    const left = q.answered
      ? `<span class="check" title="Answered">${CHECK}<span class="sr">Answered</span></span>`
      : `<button class="vote" data-act="vote" data-qid="${esc(q.id)}" aria-pressed="${q.voted}" aria-label="${q.voted ? 'Remove your vote' : 'Vote for this question'}, ${q.votes} ${q.votes === 1 ? 'vote' : 'votes'}" ${member ? '' : 'disabled'}>${ARROW}<span>${q.votes}</span></button>`;
    const rk = 'r_' + q.id;
    const reply = q.answer_text ? `<div class="reply"><span class="rname">Answer from the trainers</span><p>${esc(q.answer_text)}</p></div>` : '';
    const box = org && ui.answering === q.id
      ? `<div class="replybox"><label class="sr" for="${esc(rk)}">Your answer</label><textarea id="${esc(rk)}" data-key="${esc(rk)}" maxlength="1000" placeholder="Type the answer everyone sees under this question">${esc(drafts[rk] != null ? drafts[rk] : (q.answer_text || ''))}</textarea><div class="row"><button class="btn primary small" data-act="postReply" data-qid="${esc(q.id)}">Post answer</button><button class="btn link" data-act="cancelReply">Cancel</button></div></div>`
      : '';
    return `<div class="q${q.answered ? ' done' : ''}">${left}<div><p class="qtext">${esc(q.text)}</p>${reply}<div class="qmeta"><span>${esc(nameOf(q.user_id))}${mine ? ' (you)' : ''}</span><span>${esc(ago(q.created_at))}</span>${acts.join('')}</div>${box}</div></div>`;
  };

  let h = `<div class="qwrap">`;
  if (member) {
    h += `<div class="panel compose"><label for="q_new">Ask a question</label><p class="hint">Vote on questions you'd also like answered. The most-voted rise to the top.</p>
      <textarea id="q_new" data-key="q_new" maxlength="500" placeholder="What would you like the trainers to cover?">${val('q_new')}</textarea>
      <div class="row"><button class="btn primary" data-act="ask">Post question</button></div></div>`;
  }
  h += open.length ? open.map(qrow).join('') : `<p class="empty">No open questions.${member ? ' Ask the first one.' : ''}</p>`;
  if (done.length) {
    h += `<details class="answered" data-details="answered"${ui.answeredOpen ? ' open' : ''}><summary>Answered (${done.length})</summary>${done.map(qrow).join('')}</details>`;
  }
  return h + `</div>`;
}

function promptsHTML(member) {
  const org = state.isOrganizer;
  const ps = state.room.prompts;
  let h = '';
  if (org) {
    h += `<div class="panel compose" style="max-width:780px"><label for="pr_new">Ask the group</label><p class="hint">Participants answer from their own screen and answers show up here live.</p>
      <textarea id="pr_new" data-key="pr_new" maxlength="300" placeholder="For example: which process would you automate first?">${val('pr_new')}</textarea>
      <div class="row"><button class="btn primary" data-act="postPrompt">Post to group</button></div></div>`;
  }
  if (!ps.length) {
    return h + `<p class="empty">${org ? 'Questions you post show up here for everyone in the session.' : "No questions from the trainers yet. They'll appear here during the session."}</p>`;
  }
  for (const p of ps) {
    const ans = answersFor(p.id);
    const mine = myAnswer(p.id);
    const k = 'a_' + p.id;
    const v = drafts[k] != null ? drafts[k] : (mine ? mine.text : '');
    h += `<article class="prompt${p.is_open ? ' open' : ''}">
      <div class="phead">${p.is_open ? '<span class="chip live">Open</span>' : '<span class="chip off">Closed</span>'}<span class="muted">${esc(ago(p.created_at))}</span></div>
      <h3>${esc(p.text)}</h3>
      ${p.is_open && member ? `<label class="sr" for="${esc(k)}">Your answer</label><textarea id="${esc(k)}" data-key="${esc(k)}" maxlength="1000" placeholder="Your answer">${esc(v)}</textarea>
        <div class="row"><button class="btn primary small" data-act="answer" data-pid="${esc(p.id)}">${mine ? 'Update answer' : 'Share answer'}</button>${mine ? '<span class="muted">Shared</span>' : ''}</div>` : ''}
      <div class="resps"><p class="rlabel">${plural(ans.length, 'answer', 'answers')}</p>${ans.map((a) => {
        const name = nameOf(a.user_id);
        return `<div class="resp">${avatar(name, 'sm')}<div><span class="rname">${esc(name)}</span><p>${esc(a.text)}</p></div></div>`;
      }).join('')}</div>
      ${org ? `<div class="row"><button class="btn ghost small" data-act="togglePrompt" data-pid="${esc(p.id)}" data-val="${p.is_open ? '0' : '1'}">${p.is_open ? 'Close answers' : 'Reopen answers'}</button><button class="btn link" data-act="deletePrompt" data-pid="${esc(p.id)}">Delete</button></div>` : ''}
    </article>`;
  }
  return h;
}
