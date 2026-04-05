import { Router, Request, Response } from 'express';
import { supabaseAdmin, supabaseAuthClient, db } from '../services/supabase';
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
    // Create Supabase auth user using admin (doesn't modify session state)
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authError) {
      res.status(400).json({ error: authError.message });
      return;
    }

    // Create user record in our users table via REST helper
    let userRecord: any;
    try {
      userRecord = await db.insert('users', {
        email,
        name: name || null,
        supabase_auth_id: authData.user.id,
        tier: 'free',
      });
    } catch (dbErr: any) {
      // Rollback auth user
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      res.status(400).json({ error: dbErr?.response?.data?.message || 'Database error' });
      return;
    }

    // Sign in using the isolated auth client (does NOT affect supabaseAdmin session)
    const { data: signInData, error: signInError } = await supabaseAuthClient.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !signInData.session) {
      res.status(201).json({ message: 'Account created. Please log in.', user: userRecord });
      return;
    }

    res.status(201).json({
      token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
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
    // Use isolated auth client — does NOT contaminate supabaseAdmin session
    const { data, error } = await supabaseAuthClient.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Fetch user record via REST helper (bypasses any client state issues)
    const userRecord = await db.selectOne<{
      id: string; email: string; name: string | null; tier: string;
    }>('users', { supabase_auth_id: data.user.id }, 'id,email,name,tier');

    res.json({
      token: data.session.access_token,
      refresh_token: data.session.refresh_token,
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
    const userRecord = await db.selectOne<{
      id: string; email: string; name: string | null; tier: string; created_at: string;
    }>('users', { id: req.userId }, 'id,email,name,tier,created_at');

    if (!userRecord) {
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

// POST /auth/refresh — exchange a Supabase refresh_token for a new access_token
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    res.status(400).json({ error: 'refresh_token is required' });
    return;
  }
  try {
    const { data, error } = await supabaseAuthClient.auth.refreshSession({ refresh_token });
    if (error || !data.session) {
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }
    res.json({
      token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  } catch (err) {
    console.error('Token refresh error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/forgot-password — sends password reset email via Supabase
router.post('/forgot-password', async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: 'Email is required' });
    return;
  }
  try {
    const frontendUrl = process.env.FRONTEND_URL || 'https://mingkai1207.github.io';
    const { error } = await supabaseAuthClient.auth.resetPasswordForEmail(email, {
      redirectTo: `${frontendUrl}/scriptflare/reset-password.html`,
    });
    if (error) {
      console.error('Reset password error:', error.message);
    }
    // Always return success to avoid email enumeration
    res.json({ message: 'If an account exists with that email, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /auth/reset-password — sets new password using Supabase recovery token
router.post('/reset-password', async (req: Request, res: Response): Promise<void> => {
  const { access_token, new_password } = req.body;
  if (!access_token || !new_password || new_password.length < 8) {
    res.status(400).json({ error: 'access_token and new_password (min 8 chars) are required' });
    return;
  }
  try {
    // Verify the recovery token to get the user ID
    const { data: { user }, error: verifyError } = await supabaseAuthClient.auth.getUser(access_token);
    if (verifyError || !user) {
      res.status(401).json({ error: 'Invalid or expired reset token' });
      return;
    }
    // Update password via admin API
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: new_password,
    });
    if (updateError) {
      res.status(400).json({ error: updateError.message });
      return;
    }
    res.json({ message: 'Password updated successfully. You can now sign in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
