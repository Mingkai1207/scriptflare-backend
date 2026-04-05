import { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../services/supabase';

export interface AuthRequest extends Request {
  userId?: string;
  userTier?: 'free' | 'pro' | 'autopilot';
  userEmail?: string;
}

// Separate client for verifying user JWTs — uses anon key so it doesn't
// contaminate the admin client's auth state used for DB queries.
const supabaseVerifier = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    // Verify token using a dedicated anon-key client (doesn't affect admin client state)
    const { data: { user }, error } = await supabaseVerifier.auth.getUser(token);
    if (error || !user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    // Fetch user record — use raw REST call to avoid any Supabase JS client state issues
    const SUPABASE_URL = process.env.SUPABASE_URL!;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const axios = require('axios');

    let userRecord: { id: string; tier: string; email: string } | null = null;
    try {
      const resp = await axios.get(
        `${SUPABASE_URL}/rest/v1/users?supabase_auth_id=eq.${user.id}&select=id,tier,email&limit=1`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          },
        },
      );
      userRecord = resp.data?.[0] || null;
    } catch (axiosErr: any) {
      console.error('[Auth] REST lookup error:', axiosErr?.message);
    }

    if (!userRecord) {
      console.error('[Auth] User not found via REST:', user.id);
      res.status(401).json({ error: 'User record not found' });
      return;
    }

    req.userId = userRecord.id;
    req.userTier = userRecord.tier as 'free' | 'pro' | 'autopilot';
    req.userEmail = userRecord.email;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Authentication failed' });
  }
}

export function requireTier(minTier: 'pro' | 'autopilot') {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    const tierRank = { free: 0, pro: 1, autopilot: 2 };
    const userRank = tierRank[req.userTier || 'free'];
    const requiredRank = tierRank[minTier];

    if (userRank < requiredRank) {
      res.status(403).json({
        error: `This feature requires ${minTier} tier or higher`,
        requiredTier: minTier,
        currentTier: req.userTier,
      });
      return;
    }
    next();
  };
}
