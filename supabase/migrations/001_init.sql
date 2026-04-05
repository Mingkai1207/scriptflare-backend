-- ScriptFlare Database Schema
-- Run this in the Supabase SQL Editor: https://supabase.com/dashboard/project/odtolbarqusoqwpzxjtk/sql

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  supabase_auth_id UUID UNIQUE,
  tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'autopilot')),
  paypal_subscription_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Channel profiles table
CREATE TABLE IF NOT EXISTS channel_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  youtube_channel_url TEXT NOT NULL,
  channel_niche TEXT,
  channel_summary TEXT,
  top_keywords TEXT[] DEFAULT '{}',
  style_notes TEXT,
  avoid_topics TEXT[] DEFAULT '{}',
  last_analyzed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Autopilot configs table
CREATE TABLE IF NOT EXISTS autopilot_configs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  schedule_time TEXT NOT NULL DEFAULT '08:00', -- HH:MM format
  schedule_days INTEGER[] DEFAULT '{1,3,5}',   -- Mon, Wed, Fri
  niche TEXT NOT NULL DEFAULT 'personal finance',
  tone TEXT NOT NULL DEFAULT 'educational and engaging',
  script_length INTEGER NOT NULL DEFAULT 8,    -- minutes
  notion_token TEXT,
  notion_page_id TEXT,
  gdrive_token TEXT,
  gdrive_folder_id TEXT,
  enabled BOOLEAN NOT NULL DEFAULT false,
  last_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Generated scripts table
CREATE TABLE IF NOT EXISTS generated_scripts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  niche TEXT NOT NULL,
  script_content TEXT NOT NULL,
  quality_score INTEGER,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'autopilot')),
  delivered_to TEXT,  -- 'notion', 'gdrive', or null
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_supabase_auth_id ON users(supabase_auth_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_generated_scripts_user_id ON generated_scripts(user_id);
CREATE INDEX IF NOT EXISTS idx_generated_scripts_source ON generated_scripts(source);

-- Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE autopilot_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_scripts ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS — backend uses service role key, so no policies needed.
-- These policies are for any future direct client access:
CREATE POLICY "Service role bypass" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass" ON channel_profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass" ON autopilot_configs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role bypass" ON generated_scripts FOR ALL USING (true) WITH CHECK (true);
