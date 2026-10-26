import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, matchesKeyword, findAutomation } from '../src/engine/matcher.js';

test('normalize remove acento, pontuação e caixa', () => {
  assert.equal(normalize('  QUÉRO!!  o Link '), 'quero o link');
});

test('modo exata exige o comentário inteiro', () => {
  const k = { palavra: 'link', modo: 'exata' };
  assert.ok(matchesKeyword('LINK!', k));
  assert.ok(!matchesKeyword('quero o link', k));
});

test('modo contem casa termo inteiro, não pedaço de palavra', () => {
  const k = { palavra: 'link', modo: 'contem' };
  assert.ok(matchesKeyword('me manda o LINK por favor', k));
  assert.ok(!matchesKeyword('linkedin', k));
});

test('findAutomation respeita escopo por mídia', () => {
  const automations = [
    { id: 1, escopo: 'lista', media_ids: ['m1'], keywords: [{ palavra: 'quero', modo: 'contem' }] },
    { id: 2, escopo: 'todos', media_ids: [], keywords: [{ palavra: 'quero', modo: 'contem' }] },
  ];
  assert.equal(findAutomation(automations, { text: 'Quero!', mediaId: 'm1' }).id, 1);
  assert.equal(findAutomation(automations, { text: 'Quero!', mediaId: 'm2' }).id, 2);
  assert.equal(findAutomation(automations, { text: 'oi', mediaId: 'm2' }), null);
});
