# Refer & Earn Module

Enterprise-grade referral programme integrated into the existing **NestJS + MongoDB**
backend, the **Flutter (Riverpod)** user app, and the **React (Vite + TS)** admin.

It reuses the app's existing users, orders, wallet, JWT auth and FCM
notifications rather than duplicating them.

---

## 1. Backend structure (`laundry_be/src/referrals`)

```
referrals/
├── enums/referral.enums.ts            # ReferralStatus, RewardType, RewardStatus, FraudReason, log actions
├── schemas/
│   ├── referral.schema.ts             # one row per referee (unique refereeId)
│   ├── referral-reward.schema.ts      # reward records (referrer + referee)
│   ├── referral-settings.schema.ts    # singleton programme config
│   ├── referral-log.schema.ts         # append-only audit timeline
│   └── fraud-log.schema.ts            # fraud signals
├── dto/                               # validated request bodies/queries
├── types/referral.types.ts           # API contract types
├── utils/referral-code.util.ts        # crypto-random code generator
├── repositories/referral.repository.ts# data-access layer
├── services/
│   ├── referral.service.ts            # orchestration (validate/apply/milestones/admin)
│   ├── referral-settings.service.ts   # cached settings singleton
│   ├── referral-reward.service.ts     # wallet credit/debit (atomic + standalone fallback)
│   ├── fraud-detection.service.ts     # rule-based fraud engine
│   └── referral-analytics.service.ts  # dashboard + reports
├── referral.controller.ts             # user endpoints
├── admin-referral.controller.ts       # admin endpoints (ADMIN role)
└── referral.module.ts
```

## 2. Referral status flow

```
PENDING → REGISTERED → FIRST_ORDER_COMPLETED → PAYMENT_COMPLETED → REWARD_RELEASED
                     ↘ EXPIRED (window passed)   ↘ REJECTED (fraud/admin)
```

A reward is released only after the referee's **first successful, paid, delivered,
non-cancelled order** meeting the minimum order value. The trigger is wired in
`orders.service.ts` when an order transitions to `COMPLETED` (delivery OTP confirmed,
which is only issued after payment).

## 3. API contract

User (JWT required):

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/referral/validate` | check a code before applying |
| POST | `/referral/apply` | bind a code to the current user (once, not self) |
| GET  | `/referral/my` | code, share link, headline stats |
| GET  | `/referral/history` | paginated referral history |
| GET  | `/referral/dashboard` | Refer & Earn home payload |
| GET  | `/referral/settings` | public programme rules |

Admin (ADMIN role):

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/admin/referral/dashboard` | summary cards |
| GET  | `/admin/referral` | searchable, paginated list |
| GET  | `/admin/referral/report` | daily/weekly/monthly analytics |
| GET  | `/admin/referral/timeline/:id` | audit timeline |
| GET  | `/admin/referral/export?format=csv\|excel` | export |
| GET/POST | `/admin/referral/settings` | read/update config |
| POST | `/admin/referral/release` | release reward |
| POST | `/admin/referral/reject` | reject referral |
| POST | `/admin/referral/reverse` | claw back reward |
| POST | `/admin/referral/hold` | park for review |

## 4. Fraud detection

Evaluated at apply-time (`fraud-detection.service.ts`): self-referral, same
device, same IP (threshold), duplicate phone/email, emulator, fake GPS, optional
VPN, and multi-account velocity. Device/IP/VPN checks respect admin toggles.
Every signal is written to `fraud_logs`; hard signals auto-reject the referral.

## 5. Wallet integration

Rewards are credited via `referral-reward.service.ts` using a MongoDB transaction
(balance `$inc` + `wallet_transactions` insert together). Because dev runs on a
standalone MongoDB (no transactions), there's an automatic non-transactional
fallback. Reversals debit the wallet, floored at zero.

## 6. Integration points changed in the existing app

- `users/schemas/user.schema.ts` — added permanent unique `referralCode`.
- `users/users.service.ts` — generates a unique code on both registration paths.
- `orders/orders.service.ts` + `orders.module.ts` — reward milestone hook on `COMPLETED`.
- `app.module.ts` — registers `ReferralModule`.
- `main.ts` — `ValidationPipe` now uses `transform + implicit conversion`.
- `.env.example` — `REFERRAL_LINK_BASE`.

## 7. Environment

```
REFERRAL_LINK_BASE=https://appname.com/register   # link is <base>?ref=CODE
```

## 8. Frontend

**Flutter** (`laundry_fe/lib/features/referral`): models, `ReferralApi` (Dio),
`referralProvider` (Riverpod `Notifier`), screens (Refer & Earn home, My Referrals,
Referral Details), and `ReferralDeepLinkService` for `?ref=CODE` deep-link capture.

**React admin** (`laundry-admin/src`): `api/referralApi.ts`, `pages/ReferralPage.tsx`
(dashboard cards + management table + settings), `pages/ReferralAnalyticsPage.tsx`,
plus routes and a sidebar "Refer & Earn" group.

## 9. Remaining wiring (intentionally left to you)

- **Deep links:** connect your deep-link plugin (app_links / Firebase Dynamic
  Links) to `ReferralDeepLinkService.captureFromUri`, and call `ReferralApi.apply`
  right after registration with the pending code + device fingerprint.
- **Expiry job:** schedule `ReferralService.expireStaleReferrals()` (e.g. `@nestjs/schedule`
  daily cron) to move stale referrals to `EXPIRED`.
- **Emulator/VPN signals:** populate `isEmulator` / `isVpn` from a device
  integrity SDK on the client; the backend already consumes them.
- **Coupon/points/free-delivery rewards** are recorded and released, but their
  redemption belongs to those subsystems.
```
