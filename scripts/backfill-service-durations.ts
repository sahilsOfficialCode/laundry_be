/**
 * One-off backfill: migrates LaundryService documents from the old flat
 * `duration` field to the new `instantDuration`/`scheduledDuration` pair.
 *
 * Existing docs get instantDuration = scheduledDuration = <old duration>
 * as a safe starting point — the admin should then edit each service via the
 * admin UI to give Instant and Scheduled customers duration text tailored to
 * each flow.
 *
 * Run with: npx ts-node -r tsconfig-paths/register scripts/backfill-service-durations.ts
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
    { duration: { $exists: true } },
    [
      {
        $set: {
          instantDuration: { $ifNull: ['$instantDuration', '$duration'] },
          scheduledDuration: { $ifNull: ['$scheduledDuration', '$duration'] },
        },
      },
      { $unset: 'duration' },
    ] as any,
  );

  console.log(`Backfilled ${result.modifiedCount} service(s).`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
