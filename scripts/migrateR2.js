
import { S3Client, ListObjectsV2Command, CopyObjectCommand } from '@aws-sdk/client-s3';
import 'dotenv/config';

async function migrate() {
  const {
    CLOUDFLARE_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET,
  } = process.env;

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });

  console.log(`Listing objects in ${R2_BUCKET} with prefix "TIPS/"...`);
  const listCmd = new ListObjectsV2Command({
    Bucket: R2_BUCKET,
    Prefix: 'TIPS/'
  });

  const { Contents } = await s3.send(listCmd);
  if (!Contents || Contents.length === 0) {
    console.log('No objects found to migrate.');
    return;
  }

  for (const obj of Contents) {
    const oldKey = obj.Key;
    const newKey = oldKey.replace('TIPS/', 'Treasuries/');
    console.log(`Copying: ${oldKey} -> ${newKey}`);

    const copyCmd = new CopyObjectCommand({
      Bucket: R2_BUCKET,
      CopySource: `${R2_BUCKET}/${oldKey}`,
      Key: newKey
    });

    await s3.send(copyCmd);
  }

  console.log('\nMigration complete! New "Treasuries/" directory populated.');
}

migrate().catch(console.error);
