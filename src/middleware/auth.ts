import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { supabaseAdmin } from '../services/supabase';

export interface AuthRequest extends Request {
  userId?: string;
  userTier?: 'free' | 'pro' | 'autopilot';
  userEmail?: string;
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    // Verify with Supabase auth
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    // Get user record from our users table
    const { data: userRecord, error: dbError } = await supabaseAdmin
      .from('users')
      .select('id, tier, email')
      .eq('supabase_auth_id', user.id)
      .single();

    if (dbError || !userRecord) {
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
