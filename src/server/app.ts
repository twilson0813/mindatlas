import express from 'express';
import type { Request, Response } from 'express';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import type { HealthCheckResponse } from '../shared/types/index.js';
import itemsRouter from './routes/items.js';
import { createUploadRouter } from './routes/upload.js';
import smsRouter from './routes/sms.js';
import csvRouter from './routes/csv.js';
import webhooksRouter from './routes/webhooks.js';
import keysRouter from './routes/keys.js';
import notionRouter from './routes/notion.js';
import integrationsRouter from './routes/integrations.js';
import authRouter from './routes/auth.js';
import billingRouter, { stripeWebhookRouter } from './routes/billing.js';
import adminRouter, { createAdminSpaRouter } from './routes/admin.js';
import docsRouter from './routes/docs.js';
import { authenticateToken } from './middleware/auth.js';
import { requireAdmin } from './middleware/adminAuth.js';

export function createApp() {
  const app = express();

  // Stripe webhook must be registered BEFORE express.json() middleware
  // because it needs the raw body for signature verification
  app.use('/api/webhooks', stripeWebhookRouter);

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // OpenAPI / Swagger UI
  const openapiPath = path.resolve(process.cwd(), 'docs/openapi.yaml');
  try {
    const swaggerDocument = YAML.load(openapiPath);
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
      swaggerOptions: { tryItOutEnabled: true },
    }));
  } catch {
    // OpenAPI spec not found — skip Swagger UI in test environments
  }

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    const response: HealthCheckResponse = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
    };
    res.json(response);
  });

  // API routes
  app.use('/api/auth', authRouter);
  app.use('/api/items', itemsRouter);
  app.use('/api/items', createUploadRouter());
  app.use('/api/sms', smsRouter);
  app.use('/api/csv', csvRouter);
  app.use('/api/webhooks', webhooksRouter);
  app.use('/api/keys', keysRouter);
  app.use('/api/integrations/notion', notionRouter);
  app.use('/api/integrations', integrationsRouter);
  app.use('/api/billing', billingRouter);

  // Admin API routes (protected by admin auth + MFA)
  app.use('/api/admin', authenticateToken, requireAdmin, adminRouter);

  // Documentation
  app.use('/docs', docsRouter);

  // Admin Console SPA
  app.use(createAdminSpaRouter());

  // Serve client static files in production
  const clientBuildPath = path.resolve(process.cwd(), 'dist/client');
  app.use(express.static(clientBuildPath));

  // SPA fallback — serve index.html for all non-API routes
  app.get('*', (_req: Request, res: Response) => {
    const indexPath = path.resolve(clientBuildPath, 'index.html');
    res.sendFile(indexPath, (err) => {
      if (err) {
        res.status(404).send('Not found');
      }
    });
  });

  return app;
}
