// minúsculas, sem acento, sem pontuação, espaços colapsados
export function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// "exata": o comentário inteiro é a palavra; "contem": a palavra aparece como termo inteiro
export function matchesKeyword(text, keyword) {
  const t = normalize(text);
  const k = normalize(keyword.palavra);
  if (!k) return false;
  if (keyword.modo === 'exata') return t === k;
  return ` ${t} `.includes(` ${k} `);
}

// Primeira automação (por id) cujo escopo e palavras-chave casam com o texto
export function findAutomation(automations, { text, mediaId }) {
  for (const a of automations) {
    if (a.escopo === 'lista' && !(mediaId && a.media_ids.includes(mediaId))) continue;
    // automação sem palavras-chave dispara para qualquer texto (útil em story)
    if (!a.keywords.length || a.keywords.some((k) => matchesKeyword(text, k))) return a;
  }
  return null;
}

export function pickVariation(variations) {
  const list = (variations || []).filter((s) => s && s.trim());
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

export function jitter(min, max) {
  return Math.floor(min + Math.random() * Math.max(0, max - min));
}
