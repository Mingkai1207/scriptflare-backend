import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import billingRoutes from './routes/billing';
import trendsRoutes from './routes/trends';
import channelRoutes from './routes/channel';
import autopilotRoutes from './routes/autopilot';
import deliverRoutes from './routes/deliver';
import { initScheduler } from './scheduler';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: [
    'https://mingkai1207.github.io',
    'http://localhost:4200',
    'http://localhost:3000',
    'http://127.0.0.1:4200',
  ],
  credentials: true,
}));

// Raw body for PayPal webhooks (must come BEFORE express.json())
app.use('/billing/webhook', express.raw({ type: 'application/json' }));

// JSON body parser
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/auth', authRoutes);
app.use('/billing', billingRoutes);
app.use('/api/trends', trendsRoutes);
app.use('/api/channel', channelRoutes);
app.use('/api/autopilot', autopilotRoutes);
app.use('/api/deliver', deliverRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server + scheduler
app.listen(PORT, async () => {
  console.log(`[ScriptFlare Backend] Running on port ${PORT}`);
  await initScheduler();
});

export default app;
