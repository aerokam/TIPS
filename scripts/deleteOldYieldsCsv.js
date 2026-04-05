// One-shot: deletes the legacy Treasuries/Yields.csv key from R2.
// Run once after confirming Treasuries/YieldsDerivedFromFedInvestPrices.csv exists.
// Usage: node scripts/deleteOldYieldsCsv.js

import { S3Client, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
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

// Verify new key exists before deleting old one
try {
  await s3.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: NEW_KEY }));
  console.log(`Confirmed: ${NEW_KEY} exists.`);
} catch {
  console.error(`Abort: ${NEW_KEY} not found in R2. Run the pipeline first.`);
  process.exit(1);
}

await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: OLD_KEY }));
console.log(`Deleted: ${OLD_KEY}`);
