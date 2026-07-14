import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  redisUrl: string;
  jwtSecret: string;
  jwtRefreshSecret: string;
  encryptionMasterKey: string;
  openaiApiKey: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioPhoneNumber: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  notionClientId: string;
  notionClientSecret: string;
  notionRedirectUri: string;
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export function loadConfig(): AppConfig {
  return {
    port: parseInt(getEnvVar('PORT', '3000'), 10),
    nodeEnv: getEnvVar('NODE_ENV', 'development'),
    databaseUrl: getEnvVar('DATABASE_URL', 'postgresql://localhost:5432/mindatlas'),
    redisUrl: getEnvVar('REDIS_URL', 'redis://localhost:6379'),
    jwtSecret: getEnvVar('JWT_SECRET', 'dev-jwt-secret'),
    jwtRefreshSecret: getEnvVar('JWT_REFRESH_SECRET', 'dev-refresh-secret'),
    encryptionMasterKey: getEnvVar('ENCRYPTION_MASTER_KEY', 'dev-encryption-key-32-bytes-long!'),
    openaiApiKey: getEnvVar('OPENAI_API_KEY', ''),
    twilioAccountSid: getEnvVar('TWILIO_ACCOUNT_SID', ''),
    twilioAuthToken: getEnvVar('TWILIO_AUTH_TOKEN', ''),
    twilioPhoneNumber: getEnvVar('TWILIO_PHONE_NUMBER', ''),
    stripeSecretKey: getEnvVar('STRIPE_SECRET_KEY', ''),
    stripeWebhookSecret: getEnvVar('STRIPE_WEBHOOK_SECRET', ''),
    notionClientId: getEnvVar('NOTION_CLIENT_ID', ''),
    notionClientSecret: getEnvVar('NOTION_CLIENT_SECRET', ''),
    notionRedirectUri: getEnvVar('NOTION_REDIRECT_URI', 'http://localhost:3000/api/integrations/notion/callback'),
  };
}

export const config = loadConfig();
