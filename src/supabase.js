import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configured = Boolean(url && key);

// The session (an anonymous user) is kept in localStorage, so a participant stays the same
// person across reloads in the same browser.
export const supabase = configured
  ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'session-hub-auth' } })
  : null;
