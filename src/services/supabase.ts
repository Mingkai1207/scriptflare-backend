import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

// Admin client — bypasses RLS, used server-side only
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Public client — respects RLS
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
