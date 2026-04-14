import fs from 'fs';
import path from 'path';

/**
 * Fetch the Treasury's Tentative Auction Schedule XML and extract TIPS auctions.
 * Saves a JSON file and uploads it to R2 for the TreasuryAuctions UI to cross-reference.
 */

const TENTATIVE_XML_URL = 'https://home.treasury.gov/system/files/221/Tentative-Auction-Schedule.xml';
const OUTPUT_FILE = 'TreasuryAuctions/data/tentative_tips.json';
const R2_KEY = 'Treasuries/tentative_tips.json';

// ── R2 upload ─────────────────────────────────────────────────────────────────
async function uploadToR2(key, body) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET } = process.env;
  if (!CLOUDFLARE_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET)
    throw new Error('Cloudflare R2 credentials not found in environment variables');

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });

  await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: body, ContentType: 'application/json' }));
  console.log(`Uploaded → R2 bucket "${R2_BUCKET}", key "${key}"`);
}

async function update() {
  console.log(`Fetching tentative schedule from ${TENTATIVE_XML_URL}...`);
  const r = await fetch(TENTATIVE_XML_URL);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const xml = await r.text();

  // Extract <AuctionCalendarDate> blocks
  const blocks = xml.match(/<AuctionCalendarDate>[\s\S]*?<\/AuctionCalendarDate>/g) || [];
  const tipsAuctions = [];

  blocks.forEach(block => {
    if (block.includes('<TIPS>Y</TIPS>')) {
      const auctionDate = (block.match(/<AuctionDate>(.*?)<\/AuctionDate>/) || [])[1];
      const term = (block.match(/<SecurityTermWeekYear>(.*?)<\/SecurityTermWeekYear>/) || [])[1];
      const reopen = (block.match(/<ReOpeningIndicator>(.*?)<\/ReOpeningIndicator>/) || [])[1];
      
      if (auctionDate && term) {
        tipsAuctions.push({
          auction_date: auctionDate,
          security_term: term,
          reopening: reopen === 'Y' ? 'Yes' : 'No'
        });
      }
    }
  });

  const jsonBody = JSON.stringify(tipsAuctions, null, 2);

  // Save local copy
  const dir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, jsonBody);
  console.log(`Saved ${tipsAuctions.length} upcoming TIPS auctions to ${OUTPUT_FILE}`);

  // Upload to R2
  try {
    await uploadToR2(R2_KEY, jsonBody);
  } catch (err) {
    console.warn('R2 upload failed (check your .env if running locally):', err.message);
  }
}

update().catch(console.error);
