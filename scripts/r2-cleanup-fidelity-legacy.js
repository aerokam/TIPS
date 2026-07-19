// One-time cleanup: delete the obsolete pre-2026-06-23 Fidelity R2 objects,
// superseded by the combined Treasuries/FidelityTreasuriesTips.csv.
// See knowledge/R2_Cleanup.md, "Correction (2026-07-19)".
// Usage: node scripts/r2-cleanup-fidelity-legacy.js

import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const _envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
if (existsSync(_envPath)) {
  readFileSync(_envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([^#\s][^=]*?)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

const KEYS_TO_DELETE = [
  'Treasuries/FidelityTreasuries.csv',
  'Treasuries/FidelityTips.csv',
];

async function main() {
  const { CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!CLOUDFLARE_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET)
    throw new Error('Cloudflare R2 credentials not found in environment variables');

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });

  console.log(`Deleting ${KEYS_TO_DELETE.length} objects from R2 bucket "${R2_BUCKET}"...`);
  for (const key of KEYS_TO_DELETE) {
    await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    console.log(`Deleted: ${key}`);
  }
  console.log('Done.');
}

main().catch(err => { console.error(err); process.exit(1); });
