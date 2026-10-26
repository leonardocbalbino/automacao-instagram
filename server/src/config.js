function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

const env = process.env;

export const config = {
  env: env.NODE_ENV || 'development',
  port: Number(env.PORT || 3000),
  publicUrl: (env.PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, ''),
  databaseUrl: required('DATABASE_URL'),
  redisUrl: env.REDIS_URL || 'redis://localhost:6379',
  jwtSecret: required('JWT_SECRET'),
  // 32 bytes em base64 ou hex; fica fora do banco (AES-256-GCM)
  tokenEncryptionKey: required('TOKEN_ENCRYPTION_KEY'),
  allowSignup: env.ALLOW_SIGNUP === 'true',

  meta: {
    appId: env.IG_APP_ID || '',
    appSecret: env.IG_APP_SECRET || '',
    webhookVerifyToken: env.IG_WEBHOOK_VERIFY_TOKEN || '',
    graphVersion: env.GRAPH_VERSION || 'v23.0',
    scopes: [
      'instagram_business_basic',
      'instagram_business_content_publish',
      'instagram_business_manage_comments',
      'instagram_business_manage_messages',
    ],
  },

  limits: {
    privateRepliesPerHour: Number(env.PRIVATE_REPLIES_PER_HOUR || 750),
    jitterMinMs: Number(env.JITTER_MIN_MS || 2000),
    jitterMaxMs: Number(env.JITTER_MAX_MS || 8000),
    queueAlertSize: Number(env.QUEUE_ALERT_SIZE || 1000),
    errorRateAlert: Number(env.ERROR_RATE_ALERT || 0.05),
  },

  storage: {
    driver: env.STORAGE_DRIVER || 'local', // local | s3
    localDir: env.STORAGE_LOCAL_DIR || './uploads',
    s3: {
      endpoint: env.S3_ENDPOINT || undefined, // R2: https://<account>.r2.cloudflarestorage.com
      region: env.S3_REGION || 'auto',
      bucket: env.S3_BUCKET || '',
      accessKeyId: env.S3_ACCESS_KEY_ID || '',
      secretAccessKey: env.S3_SECRET_ACCESS_KEY || '',
      publicBaseUrl: (env.S3_PUBLIC_BASE_URL || '').replace(/\/$/, ''),
    },
  },

  alertWebhookUrl: env.ALERT_WEBHOOK_URL || '',
  bullBoard: {
    user: env.BULL_BOARD_USER || 'admin',
    password: env.BULL_BOARD_PASSWORD || '',
  },
};
