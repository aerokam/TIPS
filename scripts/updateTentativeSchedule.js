import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Load .env from repo root if present (local dev); does not override GH Actions env vars
const _envPath = resolve(dirname(fileURLToPath(import.meta.url)), '../.env');
if (existsSync(_envPath)) {
  readFileSync(_envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^\s*([^#\s][^=]*?)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  });
}

// Fetch the Treasury's Tentative Auction Schedule XML and mirror it to R2
// (the browser can't fetch home.treasury.gov directly — no CORS).

const TENTATIVE_XML_URL = 'https://home.treasury.gov/system/files/221/Tentative-Auction-Schedule.xml';
const R2_XML_KEY = 'Treasuries/Tentative-Auction-Schedule.xml';

async function uploadToR2(key, body, contentType) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!CLOUDFLARE_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET)
    throw new Error('Cloudflare R2 credentials not found in environment variables');

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });

  await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body, ContentType: contentType }));
  console.log(`Uploaded → R2 bucket "${R2_BUCKET}", key "${key}" (${contentType})`);
}

async function update() {
  console.log(`Fetching tentative schedule from ${TENTATIVE_XML_URL}...`);
  const r = await fetch(TENTATIVE_XML_URL);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const xml = await r.text();

  await uploadToR2(R2_XML_KEY, xml, 'text/xml');
}

update().catch(err => { console.error(err); process.exit(1); });
