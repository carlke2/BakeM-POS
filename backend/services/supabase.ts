import { createClient, SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';

// Node.js < 22 has no native WebSocket; Supabase client requires one at init.
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = ws as unknown as typeof WebSocket;
}

const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseServiceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

export function isSupabaseConfigured(): boolean {
  return (
    supabaseUrl.startsWith('https://') &&
    supabaseServiceKey.startsWith('eyJ') &&
    supabaseServiceKey.length > 100
  );
}

export function getSupabaseConfigError(): string | null {
  if (!supabaseUrl) return 'SUPABASE_URL is missing in backend/.env';
  if (!supabaseUrl.startsWith('https://')) return 'SUPABASE_URL must start with https://';
  if (!supabaseServiceKey) return 'SUPABASE_SERVICE_ROLE_KEY is missing in backend/.env';
  if (!supabaseServiceKey.startsWith('eyJ')) {
    return 'SUPABASE_SERVICE_ROLE_KEY is invalid - use the service_role secret from Supabase Dashboard -> Settings -> API (not the anon key)';
  }
  if (supabaseServiceKey.length < 100) {
    return 'SUPABASE_SERVICE_ROLE_KEY looks truncated - paste the full JWT from Supabase';
  }
  return null;
}

// Service role client - full access, server-side only
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export default supabase;
