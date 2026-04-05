import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../services/supabase';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// POST /auth/signup
router.post('/signup', async (req: Request, res: Response): Promise<void> => {
  const { email, password, name } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  try {
    // Create Supabase auth user
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // auto-confirm for now
    });

    if (authError) {
      res.status(400).json({ error: authError.message });
      return;
    }

    // Create user record in our table
    const { data: userRecord, error: dbError } = await supabaseAdmin
      .from('users')
      .insert({
        email,
        name: name || null,
        supabase_auth_id: authData.user.id,
        tier: 'free',
      })
      .select()
      .single();

    if (dbError) {
      // Rollback auth user
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      res.status(400).json({ error: dbError.message });
      return;
    }

    // Sign in to get a session token
    const { data: signInData, error: signInError } = await supabaseAdmin.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !signInData.session) {
      res.status(201).json({ message: 'Account created. Please log in.', user: userRecord });
      return;
    }

    res.status(201).json({
      token: signInData.session.access_token,
      user: {
        id: userRecord.id,
        email: userRecord.email,
        name: userRecord.name,
        tier: userRecord.tier,
      },
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required' });
    return;
  }

  try {
    const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Get user record
    const { data: userRecord } = await supabaseAdmin
      .from('users')
      .select('id, email, name, tier')
      .eq('supabase_auth_id', data.user.id)
      .single();

    res.json({
      token: data.session.access_token,
      user: userRecord,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /auth/me
router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { data: userRecord, error } = await supabaseAdmin
      .from('users')
      .select('id, email, name, tier, created_at')
      .eq('id', req.userId)
      .single();

    if (error || !userRecord) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user: userRecord });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/logout
router.post('/logout', async (req: Request, res: Response): Promise<void> => {
  res.json({ message: 'Logged out' });
});

export default router;
