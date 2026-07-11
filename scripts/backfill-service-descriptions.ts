/**
 * One-off backfill: migrates LaundryService documents from the old flat
 * `description` field to the new `instantDescription`/`scheduledDescription`
 * pair.
 *
 * Existing docs get instantDescription = scheduledDescription = <old description>
 * as a safe starting point — the admin should then edit each service via the
 * admin UI to give Instant and Scheduled customers copy tailored to each flow.
 *
 * Run with: npx ts-node -r tsconfig-paths/register scripts/backfill-service-descriptions.ts
 */
import * as dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set in the environment');
  }

  await mongoose.connect(uri);
  const collection = mongoose.connection.collection('laundryservices');

  const result = await collection.updateMany(
    { description: { $exists: true } },
    [
      {
        $set: {
          instantDescription: { $ifNull: ['$instantDescription', '$description'] },
          scheduledDescription: { $ifNull: ['$scheduledDescription', '$description'] },
        },
      },
      { $unset: 'description' },
    ] as any,
  );

  console.log(`Backfilled ${result.modifiedCount} service(s).`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
