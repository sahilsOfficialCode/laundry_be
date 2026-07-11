/**
 * One-off backfill: adds `instantOrderPlacedMessage` / `scheduledOrderPlacedMessage`
 * to LaundryService documents created before these fields existed.
 *
 * Unlike the description split, there is no prior single field to copy from —
 * these are brand-new admin-authored fields. Existing docs get a generic,
 * non-committal placeholder so API responses never return a missing/undefined
 * value (the Flutter app requires both as non-null strings). The admin should
 * then edit each service via the admin UI to give Instant and Scheduled
 * customers wording tailored to each flow.
 *
 * Run with: npx ts-node -r tsconfig-paths/register scripts/backfill-service-order-placed-messages.ts
 */
import * as dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';

const DEFAULT_INSTANT_MESSAGE =
  'Your order has been placed and will be picked up and delivered shortly.';
const DEFAULT_SCHEDULED_MESSAGE =
  'Your order has been placed and will be delivered as per your selected schedule.';

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGO_URI is not set in the environment');
  }

  await mongoose.connect(uri);
  const collection = mongoose.connection.collection('laundryservices');

  const result = await collection.updateMany(
    {
      $or: [
        { instantOrderPlacedMessage: { $exists: false } },
        { scheduledOrderPlacedMessage: { $exists: false } },
      ],
    },
    [
      {
        $set: {
          instantOrderPlacedMessage: {
            $ifNull: ['$instantOrderPlacedMessage', DEFAULT_INSTANT_MESSAGE],
          },
          scheduledOrderPlacedMessage: {
            $ifNull: ['$scheduledOrderPlacedMessage', DEFAULT_SCHEDULED_MESSAGE],
          },
        },
      },
    ] as any,
  );

  console.log(`Backfilled ${result.modifiedCount} service(s).`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
