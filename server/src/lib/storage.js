import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config.js';

const { storage } = config;

let s3;
function s3Client() {
  if (!s3) {
    s3 = new S3Client({
      region: storage.s3.region,
      endpoint: storage.s3.endpoint,
      credentials: { accessKeyId: storage.s3.accessKeyId, secretAccessKey: storage.s3.secretAccessKey },
    });
  }
  return s3;
}

const EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

export const ALLOWED_MIME = Object.keys(EXT);

// A Meta baixa a mídia pela URL, então ela precisa ser pública
export async function saveMedia(buffer, mimetype) {
  const ext = EXT[mimetype];
  if (!ext) throw new Error(`Formato não suportado: ${mimetype}`);
  const key = `media/${new Date().toISOString().slice(0, 7)}/${nanoid(16)}.${ext}`;
  const kind = mimetype.startsWith('video/') ? 'video' : 'image';

  if (storage.driver === 's3') {
    await s3Client().send(
      new PutObjectCommand({ Bucket: storage.s3.bucket, Key: key, Body: buffer, ContentType: mimetype }),
    );
    return { url: `${storage.s3.publicBaseUrl}/${key}`, kind };
  }

  const file = path.resolve(storage.localDir, key);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buffer);
  return { url: `${config.publicUrl}/${key}`, kind };
}
