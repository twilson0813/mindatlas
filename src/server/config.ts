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
  };
}

export const config = loadConfig();
