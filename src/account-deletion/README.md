# Account Deletion Module

Google Play compliant, in-app account deletion — integrated into the existing
**NestJS + MongoDB** backend, the **Flutter** app, and the **React** admin.

## Google Play compliance checklist

- ✅ Deletion is initiated **inside the app** (Profile → Privacy & Security → Delete Account).
- ✅ No redirect to email/support — the whole flow is self-service.
- ✅ The screen **explains what is deleted** and **what is retained**.
- ✅ **Explicit confirmation** (confirm dialog) + **identity verification** are required.
- ✅ Personal data is **deleted/anonymised**; only legally-required records are retained.
- ✅ On success the user is **logged out of every device** and returned to Login.

## Flow

```
request  →  verify (password / OTP / Google-Apple)  →  confirm  →  soft-delete + logout-all
                                                                       ↓ (retention window, default 30d)
                                                                    anonymise (cleanup job)
```

Deletion is honoured **immediately** on confirm (soft-delete). The admin panel
can **restore** the account (reject) within the retention window, or **force
immediate anonymisation** (approve). A background job anonymises automatically
once the retention window elapses.

## Backend structure (`laundry_be/src/account-deletion`)

```
account-deletion/
├── enums/account-deletion.enums.ts
├── schemas/
│   ├── delete-request.schema.ts       # one request per user (with snapshot + retentionUntil)
│   └── account-audit-log.schema.ts    # append-only audit / timeline
├── dto/account-deletion.dto.ts        # request/verify/confirm/admin DTOs (class-validator)
├── guards/rate-limit.guard.ts         # dependency-free in-memory rate limiter (@RateLimit)
├── repositories/account-deletion.repository.ts
├── services/
│   ├── account-deletion.service.ts        # request/verify/confirm/status + soft-delete
│   ├── identity-verification.service.ts   # password / OTP / Firebase re-auth
│   ├── account-cleanup.service.ts         # scheduled anonymisation (no @nestjs/schedule needed)
│   └── account-deletion-admin.service.ts  # list/timeline/approve/reject/dashboard
├── account-deletion.controller.ts     # user endpoints (rate-limited)
├── admin-account-deletion.controller.ts# admin endpoints (ADMIN role)
└── account-deletion.module.ts
```

## API

User (JWT required, rate-limited):

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/account/delete/request` | start a deletion request (reason + comment) |
| POST | `/account/delete/send-otp` | send OTP for OTP verification |
| POST | `/account/delete/verify` | verify identity (password/OTP/Firebase) |
| POST | `/account/delete/confirm` | final, irreversible confirmation |
| GET  | `/account/delete/status` | current request status |

Admin (ADMIN role):

| Method | Path | Purpose |
|--------|------|---------|
| GET  | `/admin/delete/dashboard` | summary cards + avg processing time |
| GET  | `/admin/delete/history` | searchable, paginated list |
| GET  | `/admin/delete/timeline/:id` | audit timeline |
| GET  | `/admin/delete/export?format=csv\|excel` | export |
| POST | `/admin/delete/approve` | force immediate anonymisation |
| POST | `/admin/delete/reject` | restore account (if policy allows) |

## Data retention vs removal

| Retained (legal) | Removed / anonymised (personal) |
|------------------|---------------------------------|
| Completed orders | Name, email, phone |
| Payment records  | Profile photo |
| GST invoices     | Saved addresses |
| Tax records      | Device / FCM tokens |
| Fraud & audit logs | Notification preferences |

The user document keeps its `_id` (so orders/invoices stay linkable for tax),
but PII fields are unset/blanked and `accountStatus` becomes `ANONYMIZED`.

## "Logout from every device" (stateless JWT)

The app uses long-lived stateless JWTs, so deletion sets `sessionsValidFrom` on
the user. `JwtAuthGuard` now rejects any token whose `iat` predates it, and any
deleted/disabled account — enforced via a **30-second cached** status lookup
(`AuthService.assertAccountActive`) to keep the per-request cost low. The
caller's current token is additionally blacklisted immediately.

## Integration changes to existing code

- `users/schemas/user.schema.ts` — soft-delete fields + `sessionsValidFrom`.
- `users/users.service.ts` — `getAuthStatus()` lean lookup for the guard.
- `auth/auth.service.ts` — `verifyOtpValue()` (verify OTP without login) + `assertAccountActive()` (+cache).
- `auth/auth.module.ts` — export `FirebaseAdminService` (for Google/Apple re-auth).
- `auth/guards/jwt-auth.guard.ts` — enforce deletion / logout-all.
- `app.module.ts` — register `AccountDeletionModule`.
- `.env.example` — `ACCOUNT_DELETION_RETENTION_DAYS`, `ACCOUNT_CLEANUP_INTERVAL_MS`.

## Frontend

**Flutter** (`laundry_fe/lib/features/account_deletion`): models, API, Riverpod
provider, and screens — Privacy & Security entry, Delete Account (data explained
+ reason + warning), Verification (password/OTP), confirm dialogs, animated
Success screen that auto-logs-out and returns to Login. Profile menu now has a
"Privacy & Security" entry.

**React admin** (`laundry-admin/src`): `api/accountDeletionApi.ts`,
`pages/DeleteRequestsPage.tsx` (dashboard, searchable table, restore/anonymise,
audit timeline drawer, CSV/Excel export), route + sidebar entry.

## Note on the spec's table list

The spec listed `user_sessions` and `notification_tokens` tables. This app is
stateless-JWT and stores FCM tokens on the user document, so those are handled
via `sessionsValidFrom` (sessions) and `fcmTokens` clearing (tokens) rather than
separate tables — the same guarantees without redundant collections.
