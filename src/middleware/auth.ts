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

    // Fetch user record using the admin client (service role, bypasses RLS)
    const { data: userRecord, error: dbError } = await supabaseAdmin
      .from('users')
      .select('id, tier, email')
      .eq('supabase_auth_id', user.id)
      .single();

    if (dbError || !userRecord) {
      console.error('[Auth] DB lookup failed:', {
        supabase_auth_id: user.id,
        dbError: dbError?.message,
        dbErrorCode: dbError?.code,
        userRecord,
      });
      res.status(401).json({ error: 'User record not found' });
      return;
    }

    req.userId = userRecord.id;
    req.userTier = userRecord.tier;
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
