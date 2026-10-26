import { config } from '../config.js';
import { logger } from './logger.js';

// Loga e, se configurado, envia para um webhook (Slack, Discord, etc.)
export async function alert(message, extra = {}) {
  logger.warn({ alert: true, ...extra }, message);
  if (!config.alertWebhookUrl) return;
  try {
    await fetch(config.alertWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `[automacao-insta] ${message}`, content: `[automacao-insta] ${message}`, ...extra }),
    });
  } catch (err) {
    logger.error(err, 'falha ao enviar alerta');
  }
}
