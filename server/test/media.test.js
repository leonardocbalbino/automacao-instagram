import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { storyCanvas } from '../src/lib/media.js';

const image = (width, height) => sharp({ create: { width, height, channels: 3, background: '#2f5bd3' } }).png().toBuffer();

test('storyCanvas encaixa imagem quadrada em 1080x1920 sem cortar', async () => {
  const out = await storyCanvas(await image(1080, 1080));
  const meta = await sharp(out).metadata();
  assert.equal(meta.format, 'jpeg');
  assert.equal(meta.width, 1080);
  assert.equal(meta.height, 1920);
});

test('storyCanvas mantém imagem que já é 9:16', async () => {
  const meta = await sharp(await storyCanvas(await image(720, 1280))).metadata();
  assert.deepEqual([meta.width, meta.height], [1080, 1920]);
});
