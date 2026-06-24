# Laundry App — Frontend API Reference

All requests must include the JWT token either as:
- **Cookie** `access_token` (set automatically after login), **or**
- **Header** `Authorization: Bearer <token>`

All protected routes return **401** if the token is missing/expired/revoked → frontend should redirect to login.

---

## AUTH

### Login
```
POST /auth/login
Body: { email, password, role? }
Response: { success, access_token, token, user: { id, email, name, role } }
```
→ Store `access_token` in memory or let the cookie be set automatically.

### Login via Mobile OTP — Step 1: Send OTP
```
POST /auth/mobile/send-otp
Body: { mobileNumber }
Response: { success, isNewUser, name }
```

### Login via Mobile OTP — Step 2: Verify OTP
```
POST /auth/mobile/verify-otp
Body: { mobileNumber, otp, name? }   ← name required only when isNewUser = true
Response: { success, access_token, token, user: { id, mobileNumber, name, role }, isNewUser }
```

### Get Current User
```
GET /auth/me
Headers: Bearer token required
Response: { sub, role, email, mobileNumber }
```

### Logout
```
POST /auth/logout
Headers: Bearer token required
Response: { message: "Logged out successfully" }
```
→ Token is immediately revoked on server. Frontend should clear stored token and redirect to login.

### Register (email/password)
```
POST /users
Body: { name, email, password }
Response: { _id, name, email, role }
```

### Forgot Password
```
POST /auth/forgot-password
Body: { email }
Response: { message, resetToken, expiresAt }
```

### Reset Password
```
POST /auth/reset-password
Body: { token, newPassword }
Response: { message }
```

---

## SERVICES (user-scoped — each user sees only their own)

### List My Services
```
GET /services?page=1&limit=10&search=wash
Headers: Bearer token required
Response:
{
  data: [ { _id, userId, name, price, description, category, duration, isAvailable } ],
  total: 25,
  page: 1,
  limit: 10
}
```
Frontend pagination: increment `page` param to load more. Use `total` to know when to stop.

### Add a Service
```
POST /services
Headers: Bearer token required
Body: { name, price, description, category?, duration?, isAvailable? }
Response: { _id, userId, name, price, description, ... }
```

---

## ADDRESSES (user-scoped)

### List My Addresses
```
GET /user/addresses?page=1&limit=20
Headers: Bearer token required
Response:
{
  data: [ { id, houseNo, buildingName, street, area, landmark, city, state, pincode, type, instructions, isDefault, lat, lng } ],
  total: 5,
  page: 1,
  limit: 20
}
```
→ Call this on app load / address screen open. If `total === 0`, prompt user to add address.

### Add Address (with duplicate check)
```
POST /user/addresses
Headers: Bearer token required
Body: { houseNo, buildingName?, street, area?, landmark?, city, state, pincode, type?, instructions?, isDefault?, lat?, lng? }
Response:
{
  address: { id, houseNo, street, pincode, ... },
  alreadyExists: true | false
}
```
**Frontend flow:**
```
if (response.alreadyExists) {
  // show toast: "This address is already saved"
  // highlight the existing address in the list
} else {
  // add new address to local list
}
```
Duplicate is matched by `houseNo + street + pincode` (case-insensitive).

### Update Address
```
PUT /user/addresses/:id
Headers: Bearer token required
Body: (any fields from UserAddressDto, only changed fields needed)
Response: updated address object
```

### Delete Address
```
DELETE /user/addresses/:id
Headers: Bearer token required
Response: { success: true }
```

### Set Default Address
```
PUT /user/addresses/:id/default
Headers: Bearer token required
Response: the address with isDefault: true
```

---

## CART (user-scoped)

### Get My Cart
```
GET /cart
Headers: Bearer token required
Response:
{
  _id, userId,
  items: [ { serviceId, serviceNameSnapshot, unitPriceSnapshot, quantity, subtotal } ],
  totalAmount: 350
}
```
→ If cart is empty: `{ items: [], totalAmount: 0 }`

### Add Item to Cart
```
POST /cart/items
Headers: Bearer token required
Body: { serviceId, quantity }
Response: updated cart object
```
→ If same `serviceId` already in cart, quantity is incremented (not duplicated).

### Remove Item from Cart
```
DELETE /cart/items/:serviceId
Headers: Bearer token required
Response: updated cart object
```

---

## ORDERS & PAYMENTS

### Initiate Checkout / Create Razorpay Order
```
POST /payments/create-order
Headers: Bearer token required
Body: { addressId?, ... } (CheckoutContextDto)
Response: { orderId, razorpayOrderId, amount, currency }
```
→ Pass `razorpayOrderId` to Razorpay SDK to open payment modal.

### Verify Payment (call after Razorpay success callback)
```
POST /payments/verify
Headers: Bearer token required
Body: { orderId, razorpayOrderId, razorpayPaymentId, razorpaySignature }
Response: { success: true, order }
```

### Mark Payment Failed
```
POST /payments/failed
Headers: Bearer token required
Body: { orderId }
Response: { success: true, order }
```

---

## FRONTEND — Global 401 Interceptor

Wire this up once at the API client level so every failed request auto-logs out:

```js
// axios example
axios.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      // Token expired or revoked
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);
```

```js
// fetch wrapper example
async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
      ...options.headers,
    },
  });
  if (res.status === 401) {
    clearToken();
    window.location.href = '/login';
    return;
  }
  return res.json();
}
```

---

## FRONTEND — Address Check Flow

```js
async function saveAddress(addressData) {
  const res = await apiFetch('/user/addresses', {
    method: 'POST',
    body: JSON.stringify(addressData),
  });

  if (res.alreadyExists) {
    showToast('Address already saved');
    highlightAddress(res.address.id); // scroll to it in list
  } else {
    addToAddressList(res.address);
    showToast('Address added');
  }
}
```

## FRONTEND — On App Init / Login

```js
async function onLogin(token) {
  saveToken(token);
  // Load user's data in parallel
  const [services, addresses, cart] = await Promise.all([
    apiFetch('/services?page=1&limit=20'),
    apiFetch('/user/addresses'),
    apiFetch('/cart'),
  ]);
  // render UI
}
```
