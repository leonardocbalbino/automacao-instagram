import sharp from 'sharp';
// storage.js puxa a config; import tardio deixa storyCanvas testável sem .env
const saveMedia = async (...args) => (await import('./storage.js')).saveMedia(...args);

const STORY_W = 1080;
const STORY_H = 1920;

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Não foi possível baixar a mídia (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// O Instagram não enquadra story publicado pela API: no celular ele amplia até preencher 9:16
// e corta as bordas. Aqui a imagem vai inteira para um quadro 1080x1920 com fundo desfocado.
export async function storyCanvas(input) {
  const { width, height } = await sharp(input).metadata();
  const ratio = width / height;
  if (Math.abs(ratio - STORY_W / STORY_H) < 0.01) {
    return sharp(input).resize(STORY_W, STORY_H).jpeg({ quality: 90 }).toBuffer();
  }

  const background = await sharp(input)
    .resize(STORY_W, STORY_H, { fit: 'cover' })
    .blur(40)
    .modulate({ brightness: 0.6 })
    .toBuffer();
  const foreground = await sharp(input)
    .resize(STORY_W, STORY_H, { fit: 'inside', withoutEnlargement: false })
    .toBuffer();

  return sharp(background)
    .composite([{ input: foreground, gravity: 'center' }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

// A API de publicação só aceita imagem em JPEG; story também ganha o quadro 9:16
export async function prepareImage(item, { story = false } = {}) {
  if (item.kind !== 'image') return item;
  const isJpeg = /\.jpe?g($|\?)/i.test(item.url);
  if (!story && isJpeg) return item;

  const input = await download(item.url);
  const output = story ? await storyCanvas(input) : await sharp(input).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
  return saveMedia(output, 'image/jpeg');
}
