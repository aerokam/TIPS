// One-shot: copies Treasuries/Yields.csv → Treasuries/YieldsDerivedFromFedInvestPrices.csv in R2.
// Run once to unblock apps after the rename. Then run deleteOldYieldsCsv.js when ready.
// Usage: node scripts/migrateYieldsCsvKey.js

import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
dotenv.config();

const { CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
if (!CLOUDFLARE_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
  console.error('Missing R2 credentials in .env');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const OLD_KEY = 'Treasuries/Yields.csv';
const NEW_KEY = 'Treasuries/YieldsDerivedFromFedInvestPrices.csv';

const res = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: OLD_KEY }));
const body = await res.Body.transformToString();
await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: NEW_KEY, Body: body, ContentType: 'text/csv' }));
console.log(`Copied ${OLD_KEY} → ${NEW_KEY}`);
