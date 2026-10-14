// Guards against shipping a Supabase secret / service_role key to the browser. Those keys
// bypass row level security, and anything in a VITE_ variable ends up in the public bundle.
// Returns a message describing the problem, or null when the key is a publishable/anon key.
export function supabaseKeyProblem(key) {
  if (!key) return null;
  const fix = 'Use the publishable key (sb_publishable_...) or the legacy anon key from Project Settings > API Keys.';
  if (key.startsWith('sb_secret_')) {
    return `VITE_SUPABASE_ANON_KEY is a Supabase secret key, which bypasses row level security. ${fix}`;
  }
  if (key.startsWith('eyJ')) {
    let role = null;
    try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch { /* not a JWT */ }
    if (role && role !== 'anon') {
      return `VITE_SUPABASE_ANON_KEY is a "${role}" key, which bypasses row level security. ${fix}`;
    }
  }
  return null;
}
