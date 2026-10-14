// Proves the database-level security rules against a real Supabase project.
//
// Uses three independent clients: an organizer and two participants (A and B), each its own
// anonymous user. Creates a throwaway session, runs the checks, then deletes the session and
// locks the organizer again.
//
// Run:  npm run test:rls        (reads VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and
//                                ORGANIZER_CODE from .env)
import { createClient } from '@supabase/supabase-js';

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
const organizerCode = process.env.ORGANIZER_CODE;
if (!url || !key || !organizerCode) {
  console.error('Set VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and ORGANIZER_CODE in .env first.');
  process.exit(2);
}

const newClient = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let failures = 0;
function check(label, ok, detail) {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n      ${JSON.stringify(detail)}`}`);
}
// A write that RLS or privileges must stop: either an error, or zero rows touched.
const blocked = (res) => Boolean(res.error) || (Array.isArray(res.data) && res.data.length === 0);

async function signIn(client, name) {
  const { data, error } = await client.auth.signInAnonymously();
  if (error) {
    console.error(`Anonymous sign-in failed for ${name}: ${error.message}`);
    console.error('Is "Allow anonymous sign-ins" enabled under Authentication > Sign In / Providers?');
    process.exit(2);
  }
  return data.user.id;
}

const org = newClient();
const a = newClient();
const b = newClient();
const nobody = newClient(); // never signs in
let sid = null;

try {
  await signIn(org, 'organizer');
  const aId = await signIn(a, 'participant A');
  await signIn(b, 'participant B');

  // ---------- organizer code ----------
  let r = await b.rpc('unlock_organizer', { p_code: organizerCode + '-wrong' });
  check('wrong organizer code is rejected', r.data === 'wrong_code', r);
  r = await b.rpc('is_organizer');
  check('participant is not an organizer', r.data === false, r);
  r = await org.rpc('unlock_organizer', { p_code: organizerCode });
  check('correct organizer code unlocks', r.data === 'ok', r);
  r = await b.rpc('set_organizer_code', { p_code: 'something-new-123' });
  check('participant cannot call set_organizer_code', Boolean(r.error), r);

  // ---------- session setup ----------
  r = await b.rpc('create_session', { p_title: 'Not allowed', p_date: null, p_code: 'ABCD' });
  check('participant cannot create a session', Boolean(r.error), r);
  const code = 'T' + Math.random().toString(36).slice(2, 8).toUpperCase();
  r = await org.rpc('create_session', { p_title: `RLS test ${new Date().toISOString()}`, p_date: null, p_code: code });
  sid = r.data;
  check('organizer creates a session', Boolean(sid) && !r.error, r);
  if (!sid) throw new Error('Cannot continue without a session');

  r = await nobody.from('sessions').select('id');
  check('no-session (anon role) client cannot read sessions', blocked(r), r);
  r = await a.from('sessions').select('id').eq('id', sid);
  check('anonymous user can read the session list', r.data?.length === 1, r);
  r = await a.from('session_secrets').select('session_id, code_plain').eq('session_id', sid);
  check('participant cannot read join codes', blocked(r), r);
  r = await org.from('session_secrets').select('code_plain').eq('session_id', sid);
  check('organizer can read the join code', r.data?.[0]?.code_plain === code, r);

  // ---------- non-member ----------
  r = await org.from('prompts').insert({ session_id: sid, text: 'Organizer prompt' }).select('id');
  const pid = r.data?.[0]?.id;
  check('organizer posts a prompt', Boolean(pid), r);
  for (const table of ['profiles', 'questions', 'question_votes', 'prompts', 'prompt_answers']) {
    r = await a.from(table).select('*').eq('session_id', sid);
    check(`non-member cannot read ${table}`, !r.error && r.data.length === 0, r);
  }
  r = await a.from('questions').insert({ session_id: sid, text: 'Sneaky' }).select();
  check('non-member cannot post a question', blocked(r), r);

  // ---------- joining ----------
  r = await a.rpc('join_session', { p_session_id: sid, p_code: 'WRONG1' });
  check('wrong join code is rejected', r.data === 'wrong_code', r);
  r = await a.rpc('join_session', { p_session_id: sid, p_code: code.toLowerCase() });
  check('correct join code (any case) joins', r.data === 'ok', r);
  r = await b.rpc('join_session', { p_session_id: sid, p_code: code });
  check('participant B joins', r.data === 'ok', r);

  // ---------- profiles ----------
  r = await a.from('profiles').insert({ session_id: sid, name: 'Alice', role: 'Analyst' }).select();
  check('A creates own intro', !r.error, r);
  r = await b.from('profiles').insert({ session_id: sid, name: 'Bob' }).select();
  check('B creates own intro', !r.error, r);
  r = await b.from('profiles').update({ name: 'Hacked' }).eq('session_id', sid).eq('user_id', aId).select();
  check("B cannot edit A's intro", blocked(r), r);
  r = await b.from('profiles').insert({ session_id: sid, user_id: aId, name: 'Fake A' }).select();
  check('B cannot insert an intro as A', blocked(r), r);
  r = await a.from('profiles').select('name').eq('session_id', sid).eq('user_id', aId);
  check("A's intro is unchanged", r.data?.[0]?.name === 'Alice', r);
  r = await a.from('profiles').insert({ session_id: sid, name: 'x'.repeat(61) }).select();
  check('name longer than 60 characters is rejected', blocked(r), r);

  // ---------- questions and moderation ----------
  r = await a.from('questions').insert({ session_id: sid, text: 'What about security?' }).select('id');
  const qid = r.data?.[0]?.id;
  check('A posts a question', Boolean(qid), r);
  r = await a.from('questions').insert({ session_id: sid, text: 'Pre-answered', answered: true }).select();
  check('participant cannot set answered on insert', blocked(r), r);
  r = await a.from('questions').update({ answered: true, answer_text: 'self-answered' }).eq('id', qid).select();
  check('participant cannot change moderation fields directly', blocked(r), r);
  r = await b.rpc('moderate_question', { p_question_id: qid, p_answered: true, p_hidden: null, p_answer_text: 'nope' });
  check('participant cannot call moderate_question', Boolean(r.error), r);
  r = await b.from('questions').delete().eq('id', qid).select();
  check("B cannot delete A's question", blocked(r), r);

  r = await b.from('question_votes').insert({ session_id: sid, question_id: qid }).select();
  check('B upvotes the question', !r.error, r);
  r = await b.from('question_votes').insert({ session_id: sid, question_id: qid }).select();
  check('B cannot vote twice', blocked(r), r);
  r = await a.from('question_votes').delete().eq('question_id', qid).select();
  check("A cannot remove B's vote", blocked(r), r);

  r = await org.rpc('moderate_question', { p_question_id: qid, p_answered: true, p_hidden: null, p_answer_text: 'Covered in module 3' });
  check('organizer answers the question', !r.error, r);
  r = await a.from('questions').select('answered, answer_text').eq('id', qid);
  check('participants see the answer', r.data?.[0]?.answer_text === 'Covered in module 3' && r.data[0].answered, r);
  r = await org.rpc('moderate_question', { p_question_id: qid, p_answered: null, p_hidden: true, p_answer_text: null });
  r = await b.from('questions').select('id').eq('id', qid);
  check('hidden question is invisible to participants', !r.error && r.data.length === 0, r);

  // ---------- prompts ----------
  r = await a.from('prompts').insert({ session_id: sid, text: 'Participant prompt' }).select();
  check('participant cannot create a prompt', blocked(r), r);
  r = await a.from('prompts').update({ is_open: false }).eq('id', pid).select();
  check('participant cannot close a prompt', blocked(r), r);
  r = await a.from('prompt_answers').insert({ session_id: sid, prompt_id: pid, text: 'Invoices' }).select();
  check('A answers the prompt', !r.error, r);
  r = await b.from('prompt_answers').update({ text: 'Overwritten' }).eq('prompt_id', pid).eq('user_id', aId).select();
  check("B cannot change A's answer", blocked(r), r);
  r = await org.from('prompts').update({ is_open: false }).eq('id', pid).select();
  check('organizer closes the prompt', r.data?.length === 1, r);
  r = await a.from('prompt_answers').update({ text: 'Too late' }).eq('prompt_id', pid).eq('user_id', aId).select();
  check('answers cannot change after the prompt closes', blocked(r), r);

  // ---------- session management ----------
  r = await b.rpc('set_session_open', { p_session_id: sid, p_open: false });
  check('participant cannot close joining', Boolean(r.error), r);
  r = await b.rpc('set_session_code', { p_session_id: sid, p_code: 'MINE123' });
  check('participant cannot change the join code', Boolean(r.error), r);
  r = await b.rpc('delete_session', { p_session_id: sid });
  check('participant cannot delete the session', Boolean(r.error), r);
  r = await org.rpc('set_session_open', { p_session_id: sid, p_open: false });
  r = await org.rpc('join_session', { p_session_id: sid, p_code: null }); // organizers may join without a code
  r = await b.rpc('session_stats');
  check('participant cannot read organizer stats', Boolean(r.error), r);

  // ---------- lock ----------
  r = await org.rpc('lock_organizer');
  r = await org.rpc('set_session_open', { p_session_id: sid, p_open: true });
  check('locked organizer loses organizer rights', Boolean(r.error), r);
  r = await org.rpc('unlock_organizer', { p_code: organizerCode });

} catch (e) {
  failures++;
  console.error('Unexpected error:', e);
} finally {
  if (sid) {
    const r = await org.rpc('delete_session', { p_session_id: sid });
    check('cleanup: organizer deletes the test session (cascades)', !r.error, r);
    const left = await org.from('profiles').select('user_id').eq('session_id', sid);
    check('cleanup: no session data left', !left.error && left.data.length === 0, left);
  }
  await org.rpc('lock_organizer');
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
