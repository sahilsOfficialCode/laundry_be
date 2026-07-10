# Coupons Module

## Overview

The Coupons module provides a flexible discount system for orders. Users can apply coupon codes during checkout, and the system validates, calculates discounts, and tracks usage.

## Features

- ✅ Fixed and percentage discounts
- ✅ Minimum order amount validation
- ✅ Expiry date validation
- ✅ Redemption limit tracking
- ✅ Usage history tracking
- ✅ Admin coupon management

## API Endpoints

### User-Facing Endpoints

#### Apply Coupon
```
POST /coupons/apply
Content-Type: application/json

{
  "couponCode": "WELCOME50",
  "orderAmount": 150
}

Response:
{
  "couponCode": "WELCOME50",
  "originalAmount": 150,
  "discountAmount": 50,
  "finalAmount": 100
}
```

#### Record Usage (Internal)
```
POST /coupons/record-usage
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "couponCode": "WELCOME50",
  "orderId": "507f1f77bcf86cd799439011",
  "discountAmount": 50
}

Response:
{
  "success": true
}
```

#### Get Available Coupons
```
GET /coupons/available
Authorization: Bearer <JWT>

Response:
[
  {
    "id": "507f1f77bcf86cd799439011",
    "code": "WELCOME50",
    "description": "50 Rupees off on your first order",
    "discountAmount": 50,
    "minOrderAmount": 100,
    "expiryDate": "2024-12-31T23:59:59.000Z",
    "isActive": true
  }
]
```

## Schemas

### Coupon Schema
```typescript
{
  code: string (unique, uppercase) // "WELCOME50"
  description: string // "50 Rupees off"
  discountType: 'fixed' | 'percentage' // "fixed"
  discountAmount: number // 50
  discountPercentage?: number // null if fixed
  minOrderAmount: number // 100 (minimum order value to use coupon)
  maxRedemptions?: number // null for unlimited
  totalRedemptions: number // 0 (tracks actual redemptions)
  expiryDate: Date // "2024-12-31"
  isActive: boolean // true
  createdBy?: string // "admin-user-id"
  createdAt: Date
  updatedAt: Date
}
```

### CouponUsage Schema
```typescript
{
  couponCode: string // "WELCOME50"
  userId: ObjectId // ref to User
  orderId: ObjectId // ref to Order
  discountAmount: number // 50
  createdAt: Date
}
```

## Usage Flow

### 1. User Applies Coupon at Checkout
- Frontend calls `POST /coupons/apply`
- Backend validates:
  - Coupon exists
  - Coupon is active
  - Coupon not expired
  - Order amount >= minOrderAmount
  - Max redemptions not exceeded
- Returns discount amount and final amount

### 2. Payment Success Handler
- After payment is confirmed
- Call `POST /coupons/record-usage` to track the usage
- This increments the `totalRedemptions` counter

### 3. Admin Management (Future)
- Create coupons: `POST /admin/coupons`
- Update coupons: `PUT /admin/coupons/:code`
- Deactivate coupons: `DELETE /admin/coupons/:code`
- View analytics: `GET /admin/coupons/:code/usage`

## Error Handling

### 404 Not Found
```json
{
  "statusCode": 404,
  "message": "Coupon not found",
  "error": "Not Found"
}
```

### 400 Bad Request
```json
{
  "statusCode": 400,
  "message": "This coupon has expired",
  "error": "Bad Request"
}
```

### Validation Errors
- **Coupon not found**: Code doesn't exist in database
- **Coupon inactive**: `isActive` is false
- **Coupon expired**: Current date > expiryDate
- **Minimum order amount**: orderAmount < minOrderAmount
- **Redemption limit reached**: totalRedemptions >= maxRedemptions

## Database Indexes

To ensure optimal query performance, the following indexes are created:

```typescript
// On Coupon collection
{ code: 1, isActive: 1 }
{ expiryDate: 1, isActive: 1 }

// On CouponUsage collection
{ couponCode: 1, createdAt: -1 }
{ userId: 1, createdAt: -1 }
{ orderId: 1 }
```

## Testing

### Sample Coupon Creation (for testing)
```
POST /admin/coupons
{
  "code": "WELCOME50",
  "description": "Welcome discount - 50 off",
  "discountType": "fixed",
  "discountAmount": 50,
  "minOrderAmount": 100,
  "expiryDate": "2025-12-31",
  "isActive": true
}
```

### Sample Test Cases
1. ✅ Apply valid coupon → Get discount
2. ✅ Apply expired coupon → Error
3. ✅ Apply coupon with order below minimum → Error
4. ✅ Apply coupon at max redemptions → Error
5. ✅ Apply non-existent coupon → Error
6. ✅ Record usage after payment → Success
7. ✅ Get available coupons list → See all active coupons

## Integration with Orders

When an order is placed with a coupon:

1. **Checkout Phase**
   - Call `POST /coupons/apply` to validate and get discount
   - Display final amount to user

2. **Payment Phase**
   - Process payment with final amount (including discount)

3. **Success Phase**
   - Call `POST /coupons/record-usage` to track usage
   - Update coupon redemption counter
   - Create audit trail

## Future Enhancements

- [ ] Per-user coupon limits (max uses per user)
- [ ] Coupon categories and targeting
- [ ] Auto-applied coupons based on conditions
- [ ] Referral bonuses as automatic coupons
- [ ] Bulk coupon generation
- [ ] Coupon analytics dashboard
