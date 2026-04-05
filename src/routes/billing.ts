import { Router, Request, Response } from 'express';
import axios from 'axios';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { supabaseAdmin } from '../services/supabase';

const router = Router();

const PAYPAL_BASE = process.env.PAYPAL_BASE_URL || 'https://api-m.sandbox.paypal.com';
const CLIENT_ID = process.env.PAYPAL_CLIENT_ID!;
const SECRET = process.env.PAYPAL_SECRET!;

// Plan IDs — created once in PayPal dashboard, stored here
// These will be filled in after you create plans via /billing/setup-plans
const PLAN_IDS: Record<string, string> = {
  pro: process.env.PAYPAL_PLAN_ID_PRO || '',
  autopilot: process.env.PAYPAL_PLAN_ID_AUTOPILOT || '',
};

async function getPayPalToken(): Promise<string> {
  const response = await axios.post(
    `${PAYPAL_BASE}/v1/oauth2/token`,
    'grant_type=client_credentials',
    {
      auth: { username: CLIENT_ID, password: SECRET },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
  );
  return response.data.access_token;
}

// POST /billing/create-subscription
// Creates a PayPal subscription and returns the approval URL
router.post('/create-subscription', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { tier } = req.body;
  if (!tier || !['pro', 'autopilot'].includes(tier)) {
    res.status(400).json({ error: 'tier must be "pro" or "autopilot"' });
    return;
  }

  const planId = PLAN_IDS[tier];
  if (!planId) {
    res.status(500).json({ error: `PayPal plan ID for ${tier} is not configured. Run POST /billing/setup-plans first.` });
    return;
  }

  try {
    const token = await getPayPalToken();

    const subscriptionRes = await axios.post(
      `${PAYPAL_BASE}/v1/billing/subscriptions`,
      {
        plan_id: planId,
        subscriber: { email_address: req.userEmail },
        application_context: {
          brand_name: 'ScriptFlare',
          locale: 'en-US',
          shipping_preference: 'NO_SHIPPING',
          user_action: 'SUBSCRIBE_NOW',
          return_url: `${process.env.FRONTEND_URL}/scriptflare/account.html?payment=success`,
          cancel_url: `${process.env.FRONTEND_URL}/scriptflare/account.html?payment=cancelled`,
        },
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } },
    );

    const approvalLink = subscriptionRes.data.links?.find((l: any) => l.rel === 'approve')?.href;
    if (!approvalLink) {
      res.status(500).json({ error: 'No approval URL returned by PayPal' });
      return;
    }

    res.json({
      subscription_id: subscriptionRes.data.id,
      approval_url: approvalLink,
    });
  } catch (err: any) {
    console.error('PayPal subscription creation error:', err?.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create PayPal subscription' });
  }
});

// POST /billing/webhook — PayPal IPN/Webhook handler
// PayPal sends events when subscription status changes
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  const event = req.body;
  console.log('[PayPal Webhook] Event type:', event.event_type);

  try {
    const eventType: string = event.event_type || '';
    const resource = event.resource || {};

    if (eventType === 'BILLING.SUBSCRIPTION.ACTIVATED') {
      await handleSubscriptionActivated(resource);
    } else if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED' || eventType === 'BILLING.SUBSCRIPTION.EXPIRED') {
      await handleSubscriptionCancelled(resource);
    } else if (eventType === 'BILLING.SUBSCRIPTION.UPDATED') {
      await handleSubscriptionUpdated(resource);
    }

    res.status(200).json({ received: true });
  } catch (err: any) {
    console.error('[PayPal Webhook] Error:', err.message);
    res.status(200).json({ received: true }); // Always 200 to PayPal
  }
});

async function handleSubscriptionActivated(resource: any): Promise<void> {
  const subscriptionId = resource.id;
  const planId = resource.plan_id;

  let tier: 'pro' | 'autopilot' = 'pro';
  if (planId === PLAN_IDS.autopilot) tier = 'autopilot';

  // Find user by subscription ID or email
  const subscriberEmail = resource.subscriber?.email_address;
  if (!subscriberEmail) return;

  await supabaseAdmin
    .from('users')
    .update({ tier, paypal_subscription_id: subscriptionId })
    .eq('email', subscriberEmail);

  console.log(`[PayPal Webhook] Upgraded ${subscriberEmail} to ${tier}`);
}

async function handleSubscriptionCancelled(resource: any): Promise<void> {
  const subscriptionId = resource.id;

  await supabaseAdmin
    .from('users')
    .update({ tier: 'free', paypal_subscription_id: null })
    .eq('paypal_subscription_id', subscriptionId);

  console.log(`[PayPal Webhook] Downgraded subscription ${subscriptionId} to free`);
}

async function handleSubscriptionUpdated(resource: any): Promise<void> {
  // Handle plan upgrades/downgrades
  const subscriptionId = resource.id;
  const planId = resource.plan_id;

  let tier: 'pro' | 'autopilot' = 'pro';
  if (planId === PLAN_IDS.autopilot) tier = 'autopilot';

  await supabaseAdmin
    .from('users')
    .update({ tier })
    .eq('paypal_subscription_id', subscriptionId);
}

// POST /billing/setup-plans — one-time setup: creates Pro and Autopilot plans in PayPal
// Run this once, then copy the plan IDs to .env
router.post('/setup-plans', async (req: Request, res: Response): Promise<void> => {
  try {
    const token = await getPayPalToken();
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Create product first
    let productId: string;
    const productRes = await axios.post(`${PAYPAL_BASE}/v1/catalogs/products`, {
      name: 'ScriptFlare',
      description: 'AI YouTube script generator',
      type: 'SERVICE',
      category: 'SOFTWARE',
    }, { headers });
    productId = productRes.data.id;

    // Create Pro plan ($19/mo)
    const proPlanRes = await axios.post(`${PAYPAL_BASE}/v1/billing/plans`, {
      product_id: productId,
      name: 'ScriptFlare Pro',
      description: 'Unlimited scripts, AI improve, all tools',
      billing_cycles: [{
        frequency: { interval_unit: 'MONTH', interval_count: 1 },
        tenure_type: 'REGULAR',
        sequence: 1,
        total_cycles: 0, // unlimited
        pricing_scheme: { fixed_price: { value: '19', currency_code: 'USD' } },
      }],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee_failure_action: 'CONTINUE',
        payment_failure_threshold: 3,
      },
    }, { headers });

    // Create Autopilot plan ($49/mo)
    const autopilotPlanRes = await axios.post(`${PAYPAL_BASE}/v1/billing/plans`, {
      product_id: productId,
      name: 'ScriptFlare Autopilot',
      description: 'Everything in Pro + scheduled auto-generation, channel analysis, Notion delivery',
      billing_cycles: [{
        frequency: { interval_unit: 'MONTH', interval_count: 1 },
        tenure_type: 'REGULAR',
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: { fixed_price: { value: '49', currency_code: 'USD' } },
      }],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee_failure_action: 'CONTINUE',
        payment_failure_threshold: 3,
      },
    }, { headers });

    res.json({
      message: 'Plans created! Add these to your .env file:',
      product_id: productId,
      PAYPAL_PLAN_ID_PRO: proPlanRes.data.id,
      PAYPAL_PLAN_ID_AUTOPILOT: autopilotPlanRes.data.id,
    });
  } catch (err: any) {
    console.error('PayPal setup error:', err?.response?.data || err.message);
    res.status(500).json({ error: 'Failed to set up PayPal plans', details: err?.response?.data });
  }
});

// GET /billing/status — check current subscription status
router.get('/status', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('tier, paypal_subscription_id')
    .eq('id', req.userId)
    .single();

  res.json({
    tier: user?.tier || 'free',
    paypal_subscription_id: user?.paypal_subscription_id || null,
  });
});

export default router;
