import { query } from '../lib/db.js';

// Carrega automações ativas de uma conta com palavras-chave e ações
export async function loadAutomations(accountId, gatilho) {
  const { rows } = await query(
    `SELECT a.*,
       COALESCE((SELECT json_agg(k ORDER BY k.id) FROM automation_keywords k WHERE k.automation_id = a.id), '[]') AS keywords,
       COALESCE((SELECT json_agg(x ORDER BY x.ordem, x.id) FROM automation_actions x WHERE x.automation_id = a.id), '[]') AS actions,
       (SELECT row_to_json(l) FROM links l WHERE l.automation_id = a.id ORDER BY l.id LIMIT 1) AS link
     FROM automations a
     WHERE a.account_id = $1 AND a.gatilho = $2 AND a.ativo
     ORDER BY a.id`,
    [accountId, gatilho],
  );
  return rows;
}

export async function loadAutomation(id) {
  const { rows } = await query(
    `SELECT a.*,
       COALESCE((SELECT json_agg(k ORDER BY k.id) FROM automation_keywords k WHERE k.automation_id = a.id), '[]') AS keywords,
       COALESCE((SELECT json_agg(x ORDER BY x.ordem, x.id) FROM automation_actions x WHERE x.automation_id = a.id), '[]') AS actions,
       (SELECT row_to_json(l) FROM links l WHERE l.automation_id = a.id ORDER BY l.id LIMIT 1) AS link
     FROM automations a WHERE a.id = $1`,
    [id],
  );
  return rows[0] || null;
}

export function action(automation, tipo) {
  return automation.actions.find((a) => a.tipo === tipo) || null;
}
