# Session Hub

A live companion page for online trainings of about 25 participants. Participants open a link,
pick their session, enter the join code and introduce themselves. In the session room they can
see each other's intros, ask and upvote questions, and answer questions the trainers post to
the group. Everything updates live.

- **Frontend:** Vite + vanilla JavaScript, hosted on GitHub Pages.
- **Backend:** Supabase (Postgres, anonymous auth, Realtime) in an EU region.
- **No accounts:** every visitor is signed in anonymously in the background. The session is kept
  in the browser, so a participant stays the same person when they reload the page.
- **Security lives in the database.** Row level security and `SECURITY DEFINER` functions enforce
  who can read and write what. The repository contains no join codes or organizer code, so it can
  be public.

## Setup

You need a Supabase account, a GitHub repository with this code, and Node.js 22 or newer for
local development.

### 1. Create a Supabase project in the EU

1. In the [Supabase dashboard](https://supabase.com/dashboard), choose **New project**.
2. Pick an EU region, for example **Central EU (Frankfurt)** or **West EU (Ireland)**.
3. Choose a strong database password and wait for the project to finish provisioning.

### 2. Enable anonymous sign-ins

1. Go to **Authentication → Sign In / Providers**.
2. Turn on **Allow anonymous sign-ins** and save.
3. Go to **Authentication → Rate Limits** and check the limit for anonymous sign-ins. The
   default (30 per hour per IP address) can be too low when a whole group joins from the same
   office network. Raise it to about **100 per hour**.

### 3. Run the database migration

The schema, policies, functions and Realtime setup are all in
[supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql). Use either option:

- **SQL editor:** open **SQL Editor → New query**, paste the whole file and click **Run**.
- **Supabase CLI:** `supabase link --project-ref <your-project-ref>`, then `supabase db push`.

Run it once, on a fresh project.

### 4. Set the organizer code

The organizer code unlocks the organizer view. It is stored only as a bcrypt hash. Choose a code
of at least 8 characters (it is case-sensitive) and run this in the SQL editor:

```sql
select public.set_organizer_code('choose-your-own-code-here');
```

This function can't be called from the app or the API, only from the SQL editor (or another
admin connection). Don't commit the code anywhere.

To **change** the code, run the same statement with the new code. Anyone who already unlocked
the organizer view stays an organizer until they click **Lock**. To remove everyone's organizer
access immediately, also run:

```sql
delete from public.organizers;
```

### 5. Copy the API settings

Under **Project Settings → API** (or **Data API** / **API Keys**, depending on the dashboard
version), copy:

- the **Project URL**, for example `https://abcdefgh.supabase.co`
- the **anon** / **publishable** key

The anon key is meant to be public. It only gives the access that the database policies allow.
**Never use the `service_role` / secret key in this app.**

### 6. Add repository variables in GitHub

In your GitHub repository, go to **Settings → Secrets and variables → Actions → Variables** and
add two **repository variables**:

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | your Project URL |
| `VITE_SUPABASE_ANON_KEY` | your anon / publishable key |

### 7. Enable GitHub Pages

1. Go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main`, or run the **Deploy to GitHub Pages** workflow from the **Actions** tab.

The site is published at `https://<owner>.github.io/<repository>/`. The workflow sets the Vite
base path from the repository name automatically.

### 8. Check that it works

1. Open the published site and click **Organizer view**. Enter your organizer code.
2. Create a session, then open the site in a private window (a separate anonymous participant)
   and join with the code.
3. Optionally run the RLS test script against the project (see below).

## Run locally

```bash
npm ci
cp .env.example .env    # then fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev             # http://localhost:5173
```

`npm run build` creates a production build in `dist/`. `npm run preview` serves that build.

## Test the security rules

[tests/rls.test.mjs](tests/rls.test.mjs) runs against your real Supabase project. It uses three
separate anonymous clients: an organizer and participants A and B. It checks that:

- a non-member can't read a session's intros, questions, votes, prompts or answers
- a participant can't edit someone else's intro, answer or vote, and can't moderate questions
- moderation fields can't be changed directly
- wrong join codes and wrong organizer codes are rejected
- participants can't create, close, re-code or delete sessions, or post trainer questions

To run it, add `ORGANIZER_CODE=...` to your `.env` (without a `VITE_` prefix, so it never ends up
in the browser build) and run:

```bash
npm run test:rls
```

The script creates a throwaway session and deletes it at the end. Each run signs in three new
anonymous users, which count towards the anonymous sign-in rate limit. It also records one failed
organizer-code attempt for participant B.

## Running a training

1. **Before:** open the organizer view, create the session (title, date, join code) and share the
   site link. Sessions are open for joining when created.
2. **At the start:** share the join code. Participants pick the session, enter the code and write
   their intro.
3. **During:** in the session room, answer participant questions (**Write answer**, **Mark
   answered**, **Remove**). Use **From the trainers** to post questions to the group. Close the
   answers when you're done with a question.
4. **Afterwards:** close joining, and delete the session data (see below).

The organizer view stays unlocked in that browser until you click **Lock**.

## Deleting session data after a training

The intro form tells participants that the organizer deletes the session data afterwards. To do
that:

1. **Delete the session** in the organizer view (**Delete → Delete session**). This permanently
   removes the session and everything in it: join code, members, intros, questions, votes,
   trainer questions and answers.
2. **Optionally remove old anonymous users.** Each participant browser creates an anonymous user
   in **Authentication → Users**. They contain no names or content, but you can clean them up in
   the SQL editor:

   ```sql
   delete from auth.users
   where is_anonymous and created_at < now() - interval '7 days';
   ```

   This also removes organizer access for anonymous users older than that, so you'll need to
   unlock the organizer view again next time.

To check that nothing is left, run `select id, title, session_date from public.sessions;`.

## How the data is protected

| Table | Readable by | Writable by |
| --- | --- | --- |
| `sessions` (title, date, open) | any signed-in visitor, including anonymous | organizer functions only |
| `session_secrets` (join code) | organizers (plaintext only; the hash is never exposed) | functions only |
| `session_members` | yourself, organizers | `join_session` only |
| `profiles`, `questions`, `question_votes`, `prompt_answers` | members of that session, organizers | your own rows, in sessions you joined |
| `prompts` (questions from the trainers) | members of that session, organizers | organizers |
| `private.settings` (organizer code hash) | nobody; not exposed through the API | `set_organizer_code` |

- Join codes and the organizer code are verified with bcrypt (`pgcrypto`) inside
  `SECURITY DEFINER` functions with a fixed, empty `search_path`.
- After 10 wrong codes in 10 minutes, a user is temporarily blocked from trying again.
- Participants can only insert the question text. `answered`, `hidden` and the trainers' answer
  can only be changed through `moderate_question`, which is organizer-only. Questions the
  organizer removes are hidden from participants by the database itself.
- Answers to trainer questions can only be added or changed while that question is open.
- Length limits are `CHECK` constraints: name 60, role and organization 80, goal 400,
  question 500, answers 1000, trainer question 300, session title 90.
- Deleting a session cascades to all of its data.

## Project structure

```
index.html                   page shell (top bar, hero, main, footer)
vite.config.js               base path for GitHub Pages
src/
  main.js                    startup, anonymous sign-in, event handling
  supabase.js                Supabase client
  api.js                     queries and RPC calls
  data.js                    loads data into state; selectors for the views
  realtime.js                live updates
  actions.js                 what each button does
  render.js                  render loop that keeps typing, focus and cursor
  state.js                   app state and drafts
  views/                     one module per screen
  styles.css                 Cegeka styling, dark mode, responsive
supabase/migrations/0001_init.sql
tests/rls.test.mjs
.github/workflows/deploy.yml
```
