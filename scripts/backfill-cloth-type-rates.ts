/**
 * One-off backfill: migrates ClothType documents from the old flat `rate`
 * field to the new `instantRate`/`scheduledRate` pair.
 *
 * Existing docs get instantRate = scheduledRate = <old rate> as a safe
 * starting point — the business owner must then edit real Express/Standard
 * prices (and optional discounts) per cloth type via the admin UI.
 *
 * Run with: npx ts-node -r tsconfig-paths/register scripts/backfill-cloth-type-rates.ts
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
  const collection = mongoose.connection.collection('clothtypes');

  const result = await collection.updateMany(
    { rate: { $exists: true } },
    [
      {
        $set: {
          instantRate: { $ifNull: ['$instantRate', '$rate'] },
          scheduledRate: { $ifNull: ['$scheduledRate', '$rate'] },
        },
      },
      { $unset: 'rate' },
    ] as any,
  );

  console.log(`Backfilled ${result.modifiedCount} cloth type(s).`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
