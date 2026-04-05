import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

// Admin client — service role key, bypasses RLS.
// IMPORTANT: Never call auth.signInWithPassword() on this client — it modifies
// internal session state and causes subsequent DB queries to use the user JWT
// instead of the service role key. Use supabaseAuthClient for sign-in operations.
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Separate client for performing user sign-in/sign-up — uses anon key.
// Keeps session state completely isolated from supabaseAdmin.
export const supabaseAuthClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Public client — respects RLS (kept for potential future use)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// -----------------------------------------------------------
// Direct REST helper — uses raw HTTP to avoid any JS client
// session-state issues. Always uses service role key.
// -----------------------------------------------------------
const restHeaders = () => ({
  apikey: supabaseServiceKey,
  Authorization: `Bearer ${supabaseServiceKey}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
});

export const db = {
  /** SELECT rows with simple equality filters */
  async select<T = any>(table: string, filters: Record<string, any> = {}, cols = '*'): Promise<T[]> {
    const params = Object.entries(filters)
      .map(([k, v]) => `${encodeURIComponent(k)}=eq.${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${supabaseUrl}/rest/v1/${table}?${params}&select=${cols}`;
    const { data } = await axios.get(url, { headers: restHeaders() });
    return data as T[];
  },

  /** SELECT single row — throws if not found */
  async selectOne<T = any>(table: string, filters: Record<string, any>, cols = '*'): Promise<T | null> {
    const rows = await db.select<T>(table, filters, cols);
    return rows[0] ?? null;
  },

  /** INSERT a single row, returns inserted row */
  async insert<T = any>(table: string, row: Record<string, any>): Promise<T> {
    const url = `${supabaseUrl}/rest/v1/${table}`;
    const { data } = await axios.post(url, row, { headers: restHeaders() });
    return (Array.isArray(data) ? data[0] : data) as T;
  },

  /** UPDATE rows matching filters */
  async update(table: string, updates: Record<string, any>, filters: Record<string, any>): Promise<void> {
    const params = Object.entries(filters)
      .map(([k, v]) => `${encodeURIComponent(k)}=eq.${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${supabaseUrl}/rest/v1/${table}?${params}`;
    await axios.patch(url, updates, { headers: restHeaders() });
  },

  /** UPSERT a row */
  async upsert<T = any>(table: string, row: Record<string, any>, onConflict: string): Promise<T> {
    const url = `${supabaseUrl}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`;
    const headers = { ...restHeaders(), Prefer: 'return=representation,resolution=merge-duplicates' };
    const { data } = await axios.post(url, row, { headers });
    return (Array.isArray(data) ? data[0] : data) as T;
  },
};

// Database types
export interface User {
  id: string;
  email: string;
  name: string | null;
  supabase_auth_id: string;
  tier: 'free' | 'pro' | 'autopilot';
  paypal_subscription_id: string | null;
  created_at: string;
}

export interface ChannelProfile {
  id: string;
  user_id: string;
  youtube_channel_url: string;
  channel_niche: string | null;
  channel_summary: string | null;
  top_keywords: string[];
  style_notes: string | null;
  avoid_topics: string[];
  last_analyzed_at: string | null;
}

export interface AutopilotConfig {
  id: string;
  user_id: string;
  schedule_time: string; // e.g. "08:00"
  schedule_days: number[]; // 0=Sun,1=Mon,...,6=Sat
  niche: string;
  tone: string;
  script_length: number; // minutes
  notion_token: string | null;
  notion_page_id: string | null;
  gdrive_token: string | null;
  gdrive_folder_id: string | null;
  enabled: boolean;
  last_run_at: string | null;
}

export interface GeneratedScript {
  id: string;
  user_id: string;
  topic: string;
  niche: string;
  script_content: string;
  quality_score: number | null;
  source: 'manual' | 'autopilot';
  delivered_to: string | null;
  created_at: string;
}
