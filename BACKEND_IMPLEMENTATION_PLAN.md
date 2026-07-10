# Backend Implementation Plan - Referral & Coupon Systems

## Current Status Analysis

### ✅ Already Exists (Referral System)
- Referral module with controller, service, repository
- Schemas for referral records and codes
- User model with referralCode field
- Code generation, validation, and application logic
- Reward calculation system
- Fraud detection
- History tracking

### ❌ Missing (Coupon System)
- No coupons module
- No coupon schemas
- No coupon service
- No coupon controller
- No coupon validation logic
- No usage tracking

### ⚠️ Partially Done (Referral)
- Logic exists but needs to match frontend API contract
- `recordFirstOrder` method exists but needs verification
- Wallet/balance calculation may need updates
- Redemption logic may not be present

---

## Frontend API Contract vs Backend Reality

### Referral Endpoints

#### Frontend expects: `POST /api/referrals/join`
**Backend has:** `POST /referral/apply`
**Status:** ✅ Exists, different path
**Action:** May need to add new endpoint OR update controller

#### Frontend expects: `POST /api/referrals/record-first-order`
**Backend has:** Some logic in `recordFirstOrder` around line 325
**Status:** ⚠️ Partially exists
**Action:** Verify it works, may need new endpoint

#### Frontend expects: `GET /api/referrals/my-code`
**Backend has:** `GET /referral/my` (returns more than just code)
**Status:** ✅ Exists, different format
**Action:** May need new endpoint or adjust response

#### Frontend expects: `GET /api/referrals/wallet`
**Backend has:** No dedicated wallet endpoint
**Status:** ❌ Missing
**Action:** Need to create

#### Frontend expects: `POST /api/referrals/redeem-wallet`
**Backend has:** Unknown
**Status:** ❌ Probably missing
**Action:** Need to create

#### Frontend expects: `GET /api/referrals/history`
**Backend has:** `GET /referral/history`
**Status:** ✅ Exists
**Action:** Verify format matches

---

## Implementation Plan

### Phase 1: Verify Existing Referral System (1 hour)
- [ ] Read full referral service
- [ ] Check all schemas (referral, reward, user)
- [ ] Verify recordFirstOrder method
- [ ] Check wallet/balance logic
- [ ] Test existing endpoints with Postman

### Phase 2: Create Coupon System (3 hours)

#### 2.1: Create Schemas
- [ ] CouponSchema (code, description, discount, min_order, expiry, active)
- [ ] CouponUsageSchema (code, user, order, discount, date)

#### 2.2: Create Module Structure
```
src/coupons/
├── coupons.module.ts
├── coupons.controller.ts
├── dto/
│   ├── apply-coupon.dto.ts
│   ├── record-usage.dto.ts
│   └── create-coupon.dto.ts
├── services/
│   └── coupons.service.ts
├── repositories/
│   └── coupons.repository.ts
├── schemas/
│   ├── coupon.schema.ts
│   └── coupon-usage.schema.ts
└── README.md
```

#### 2.3: Implement Services
- CouponsService with methods:
  - `applyCoupon(code, amount)` - Validate & calculate discount
  - `recordUsage(code, userId, orderId, discount)`
  - `getAvailable()` - List active coupons
  - `validateCode(code, amount)` - Internal validation

#### 2.4: Implement Controller
- POST `/coupons/apply` - Apply coupon
- POST `/coupons/record-usage` - Track usage
- GET `/coupons/available` - List offers

#### 2.5: Create Admin Controller
- POST `/admin/coupons` - Create coupon
- PUT `/admin/coupons/:code` - Edit coupon
- DELETE `/admin/coupons/:code` - Deactivate coupon
- GET `/admin/coupons` - List all coupons
- GET `/admin/coupons/usage` - Analytics

### Phase 3: Update Referral System (2 hours)
- [ ] Add wallet balance calculation
- [ ] Add `recordFirstOrder` endpoint
- [ ] Add `redeemWallet` endpoint
- [ ] Update to match frontend API contract

### Phase 4: Integration with Orders (1 hour)
- [ ] When order payment completes:
  - Record coupon usage
  - Record referral first order
  - Update wallet balances

### Phase 5: Testing (2 hours)
- [ ] Unit tests for coupon validation
- [ ] Integration tests for end-to-end flow
- [ ] Postman tests for all endpoints

---

## Database Schema Design

### Coupon Schema
```typescript
{
  _id: ObjectId
  code: String (unique, uppercase) // "WELCOME50"
  description: String // "50 Rupees off"
  discountType: 'fixed' | 'percentage'
  discountAmount: Number // 50
  discountPercentage: Number // null if fixed
  minOrderAmount: Number // 100
  maxRedemptions: Number // null for unlimited
  totalRedeemptions: Number // 0
  expiryDate: Date
  isActive: Boolean
  createdAt: Date
  updatedAt: Date
}
```

### CouponUsage Schema
```typescript
{
  _id: ObjectId
  couponCode: String (ref: Coupon.code)
  userId: ObjectId (ref: User._id)
  orderId: ObjectId (ref: Order._id)
  discountAmount: Number
  createdAt: Date
}
```

### ReferralWallet Schema (if doesn't exist)
```typescript
{
  _id: ObjectId
  userId: ObjectId (ref: User._id, unique)
  balance: Number // 0
  totalEarned: Number // 50
  totalReferrals: Number // 1
  createdAt: Date
  updatedAt: Date
}
```

---

## API Endpoints to Create/Update

### User-facing Coupon Endpoints
```
POST /coupons/apply
  Body: { couponCode: string, orderAmount: number }
  Response: { couponCode, originalAmount, discountAmount, finalAmount }

POST /coupons/record-usage  [Internal, called after payment]
  Body: { couponCode, orderId, discountAmount }
  
GET /coupons/available
  Response: [{ code, description, discountAmount, minOrderAmount, expiryDate }]
```

### User-facing Referral Endpoints (New/Updated)
```
POST /referrals/join  [or /referral/apply]
  Body: { referralCode }
  Response: { success, message }

POST /referrals/generate  [or built into signup]
  Response: { code, userId, createdAt }

GET /referrals/my-code
  Response: { code, userId, createdAt }

GET /referrals/wallet
  Response: { balance, totalEarned, totalReferrals, records: [...] }

POST /referrals/record-first-order  [Internal]
  Body: { orderId, orderAmount }

POST /referrals/redeem-wallet
  Body: { amount }
  Response: { success, newBalance }

GET /referrals/history
  Response: { data: [...], pagination: {...} }
```

### Admin Endpoints (Bonus)
```
POST /admin/coupons
PUT /admin/coupons/:code
DELETE /admin/coupons/:code
GET /admin/coupons
GET /admin/coupons/:code/usage
```

---

## Implementation Priority

**Critical Path (Must Do):**
1. Create Coupon Module - 3 hours
2. Create Coupon Schemas - 30 min
3. Implement Apply Coupon - 1 hour
4. Implement Record Usage - 30 min
5. Verify Referral recordFirstOrder - 1 hour
6. Verify Wallet balance logic - 1 hour
7. Create missing referral endpoints - 2 hours
8. Integration testing - 2 hours

**Total: 10-11 hours**

**Nice to Have:**
- Admin coupon management
- Usage analytics
- Fraud detection for coupons
- Rate limiting

---

## File Structure Overview

```
src/
├── coupons/  [NEW]
│   ├── coupons.controller.ts
│   ├── coupons.module.ts
│   ├── dto/
│   │   ├── apply-coupon.dto.ts
│   │   ├── record-usage.dto.ts
│   │   └── create-coupon.dto.ts
│   ├── schemas/
│   │   ├── coupon.schema.ts
│   │   └── coupon-usage.schema.ts
│   ├── services/
│   │   └── coupons.service.ts
│   └── repositories/
│       └── coupons.repository.ts
│
├── referrals/  [UPDATE]
│   ├── referral.controller.ts  [Add new endpoints]
│   ├── services/
│   │   └── referral.service.ts  [Add wallet methods]
│   └── schemas/
│       └── referral-wallet.schema.ts  [NEW if needed]
│
└── app.module.ts  [Register CouponsModule]
```

---

## Testing Strategy

### Unit Tests
- Coupon validation logic
- Discount calculation
- Wallet balance updates
- Referral code generation

### Integration Tests
- Apply coupon → Get discount
- Complete payment → Record coupon usage
- Complete payment → Record referral first order
- Redeem wallet → Check balance update

### End-to-End Tests
- Full user flow: Sign up → Apply referral → Place order → Earn reward
- Full coupon flow: Apply coupon → Complete payment → Track usage

---

## Timeline

- Phase 1 (Verify): 1 hour
- Phase 2 (Coupons): 3 hours  
- Phase 3 (Referrals): 2 hours
- Phase 4 (Integration): 1 hour
- Phase 5 (Testing): 2 hours

**Total: ~9 hours**

---

## Success Criteria

✅ All 10 API endpoints working
✅ Coupons properly validated
✅ Discounts correctly calculated  
✅ Wallet balances updated
✅ Referral rewards tracked
✅ Usage tracked in database
✅ Admin can create/manage coupons
✅ End-to-end flow works without errors

---

**Status: Ready to Start** 🚀

Next step: Start Phase 1 - Verify existing referral system
