# Referral System - Complete Implementation

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  Referral System Flow                    │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  User A                          User B                  │
│  ┌──────────────┐               ┌──────────────┐        │
│  │ Gets Code    │               │ Joins App    │        │
│  │ AJAY_ABC123  │──Share──→     │ With Code    │        │
│  │ Share Link   │               │ AJAY_ABC123  │        │
│  └──────────────┘               └──────────────┘        │
│        ↓                              ↓                   │
│   ₹50 Reward                   ₹50 Reward               │
│   (on User B signup)           (on first order)         │
│                                                           │
│  Both tracked in database                                │
│  Analytics: Referrals, Earnings, Active codes           │
│                                                           │
└─────────────────────────────────────────────────────────┘
```

---

## Database Schema

### 1. Referral Codes Table

```sql
CREATE TABLE referral_codes (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL UNIQUE,
  code VARCHAR(20) UNIQUE NOT NULL,
  reward_amount DECIMAL(10, 2) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  total_referrals INT DEFAULT 0,
  total_earnings DECIMAL(12, 2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_code (code),
  INDEX idx_user (user_id),
  INDEX idx_active (is_active),
  INDEX idx_earnings (total_earnings DESC)
);
```

### 2. Referrals Table (Track Who Referred Whom)

```sql
CREATE TABLE referrals (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  referrer_id BIGINT NOT NULL,
  referred_user_id BIGINT NOT NULL,
  referral_code VARCHAR(20) NOT NULL,
  
  -- Rewards tracking
  referrer_reward_amount DECIMAL(10, 2),
  referrer_reward_status ENUM('pending', 'credited') DEFAULT 'pending',
  referrer_reward_date DATETIME,
  
  referred_user_reward_amount DECIMAL(10, 2),
  referred_user_reward_status ENUM('pending', 'credited') DEFAULT 'pending',
  referred_user_reward_date DATETIME,
  
  -- Completion tracking
  referred_user_first_order_id BIGINT,
  referred_user_first_order_date DATETIME,
  
  status ENUM('active', 'completed', 'cancelled') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (referred_user_first_order_id) REFERENCES orders(id),
  UNIQUE KEY unique_referral (referrer_id, referred_user_id),
  INDEX idx_referrer (referrer_id),
  INDEX idx_referred (referred_user_id),
  INDEX idx_code (referral_code),
  INDEX idx_status (status),
  INDEX idx_reward_status (referrer_reward_status)
);
```

### 3. Referral Settings (Admin configurable)

```sql
CREATE TABLE referral_settings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  referrer_reward_amount DECIMAL(10, 2) DEFAULT 50.00,
  referred_user_reward_amount DECIMAL(10, 2) DEFAULT 50.00,
  referrer_reward_trigger ENUM('signup', 'first_order') DEFAULT 'first_order',
  referred_user_reward_trigger ENUM('signup', 'first_order') DEFAULT 'signup',
  min_order_value_for_reward DECIMAL(10, 2) DEFAULT 0,
  max_referrals_per_user INT,
  referral_validity_days INT DEFAULT 365,
  is_active BOOLEAN DEFAULT TRUE,
  updated_by_admin_id BIGINT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (updated_by_admin_id) REFERENCES admins(id)
);
```

### 4. Referral Wallet (Store rewards before crediting to main wallet)

```sql
CREATE TABLE referral_wallet (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL UNIQUE,
  balance DECIMAL(12, 2) DEFAULT 0,
  total_earned DECIMAL(12, 2) DEFAULT 0,
  total_spent DECIMAL(12, 2) DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user (user_id)
);

-- Transaction table for audit trail
CREATE TABLE referral_wallet_transactions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  type ENUM('credit', 'debit') NOT NULL,
  amount DECIMAL(10, 2) NOT NULL,
  description TEXT,
  referral_id BIGINT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (referral_id) REFERENCES referrals(id),
  INDEX idx_user (user_id),
  INDEX idx_created (created_at)
);
```

---

## Backend API Implementation

### File: `models/ReferralCode.js`

```javascript
const mongoose = require('mongoose');

const referralCodeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  code: {
    type: String,
    unique: true,
    required: true,
    uppercase: true
  },
  rewardAmount: {
    type: Number,
    default: 50
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  totalReferrals: {
    type: Number,
    default: 0
  },
  totalEarnings: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Index for fast lookups
referralCodeSchema.index({ code: 1 });
referralCodeSchema.index({ userId: 1 });
referralCodeSchema.index({ totalEarnings: -1 });

module.exports = mongoose.model('ReferralCode', referralCodeSchema);
```

### File: `models/Referral.js`

```javascript
const mongoose = require('mongoose');

const referralSchema = new mongoose.Schema({
  referrerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  referredUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  referralCode: String,
  
  // Referrer rewards
  referrerRewardAmount: Number,
  referrerRewardStatus: {
    type: String,
    enum: ['pending', 'credited'],
    default: 'pending'
  },
  referrerRewardDate: Date,
  
  // Referred user rewards
  referredUserRewardAmount: Number,
  referredUserRewardStatus: {
    type: String,
    enum: ['pending', 'credited'],
    default: 'pending'
  },
  referredUserRewardDate: Date,
  
  // First order tracking
  referredUserFirstOrderId: mongoose.Schema.Types.ObjectId,
  referredUserFirstOrderDate: Date,
  
  status: {
    type: String,
    enum: ['active', 'completed', 'cancelled'],
    default: 'active'
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Compound unique index
referralSchema.index({ referrerId: 1, referredUserId: 1 }, { unique: true });
referralSchema.index({ referralCode: 1 });
referralSchema.index({ status: 1 });

module.exports = mongoose.model('Referral', referralSchema);
```

### File: `controllers/referralController.js`

```javascript
const ReferralCode = require('../models/ReferralCode');
const Referral = require('../models/Referral');
const User = require('../models/User');
const ReferralWallet = require('../models/ReferralWallet');
const ReferralSettings = require('../models/ReferralSettings');

// ── Generate Referral Code for User ────────────────────────
exports.generateReferralCode = async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if user already has a code
    let referralCode = await ReferralCode.findOne({ userId });

    if (referralCode) {
      return res.status(200).json({
        success: true,
        code: referralCode.code,
        message: 'Referral code already exists'
      });
    }

    // Generate unique code: FIRSTNAME_RANDOMSTRING
    const user = await User.findById(userId);
    const randomString = Math.random().toString(36).substring(2, 8).toUpperCase();
    const code = `${user.firstName.toUpperCase()}_${randomString}`;

    referralCode = await ReferralCode.create({
      userId,
      code,
      rewardAmount: 50 // Default, will use settings
    });

    // Create wallet for referral rewards
    await ReferralWallet.create({
      userId,
      balance: 0
    });

    return res.status(201).json({
      success: true,
      message: 'Referral code generated',
      code: referralCode.code,
      rewardAmount: referralCode.rewardAmount
    });

  } catch (error) {
    console.error('Generate referral code error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error generating referral code'
    });
  }
};

// ── Get User's Referral Code & Stats ──────────────────────
exports.getMyReferralCode = async (req, res) => {
  try {
    const userId = req.user.id;

    const referralCode = await ReferralCode.findOne({ userId });

    if (!referralCode) {
      return res.status(404).json({
        success: false,
        message: 'Referral code not found. Generate one first.'
      });
    }

    // Get wallet balance
    const wallet = await ReferralWallet.findOne({ userId });

    return res.status(200).json({
      success: true,
      referral: {
        code: referralCode.code,
        rewardAmount: referralCode.rewardAmount,
        totalReferrals: referralCode.totalReferrals,
        totalEarnings: referralCode.totalEarnings,
        walletBalance: wallet?.balance || 0,
        shareUrl: `https://laundrybrew.com/join?code=${referralCode.code}`,
        deepLink: `laundrybrew://join?code=${referralCode.code}`
      }
    });

  } catch (error) {
    console.error('Get referral code error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching referral code'
    });
  }
};

// ── Join With Referral Code (Called on sign-up) ───────────
exports.joinWithReferralCode = async (req, res) => {
  try {
    const { referralCode } = req.body;
    const newUserId = req.user.id;

    // Find the referral code
    const refCode = await ReferralCode.findOne({ code: referralCode.toUpperCase() });

    if (!refCode) {
      return res.status(400).json({
        success: false,
        message: 'Invalid referral code'
      });
    }

    const referrerId = refCode.userId;

    // Prevent self-referral
    if (referrerId.toString() === newUserId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot use your own referral code'
      });
    }

    // Check if already referred by this user
    const existingReferral = await Referral.findOne({
      referrerId,
      referredUserId: newUserId
    });

    if (existingReferral) {
      return res.status(400).json({
        success: false,
        message: 'Already referred by this user'
      });
    }

    // Get referral settings
    const settings = await ReferralSettings.findOne({ is_active: true });

    // Create referral record
    const referral = await Referral.create({
      referrerId,
      referredUserId: newUserId,
      referralCode: referralCode.toUpperCase(),
      referrerRewardAmount: settings?.referrer_reward_amount || 50,
      referredUserRewardAmount: settings?.referred_user_reward_amount || 50
    });

    // Credit referred user immediately (if trigger is signup)
    if (settings?.referred_user_reward_trigger === 'signup') {
      await creditReward(
        newUserId,
        settings.referred_user_reward_amount,
        referral._id,
        'referred_user'
      );
    }

    return res.status(200).json({
      success: true,
      message: 'Referral recorded successfully',
      referral: {
        referrerId,
        reward: settings?.referred_user_reward_amount || 50
      }
    });

  } catch (error) {
    console.error('Join with referral code error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error processing referral code'
    });
  }
};

// ── Record First Order (Check for referrer reward) ────────
exports.recordFirstOrder = async (req, res) => {
  try {
    const { orderId, orderAmount } = req.body;
    const userId = req.user.id;

    // Find referral record where this user is referred
    const referral = await Referral.findOne({
      referredUserId: userId,
      status: 'active'
    });

    if (!referral) {
      return res.status(200).json({
        success: true,
        message: 'No referral found for this user'
      });
    }

    // Get settings
    const settings = await ReferralSettings.findOne({ is_active: true });

    // Check minimum order value
    if (orderAmount < (settings?.min_order_value_for_reward || 0)) {
      return res.status(200).json({
        success: true,
        message: 'Order amount below minimum for referral reward'
      });
    }

    // Update referral with first order
    referral.referredUserFirstOrderId = orderId;
    referral.referredUserFirstOrderDate = new Date();

    // Credit referrer reward
    if (referral.referrerRewardStatus === 'pending') {
      await creditReward(
        referral.referrerId,
        referral.referrerRewardAmount,
        referral._id,
        'referrer'
      );

      referral.referrerRewardStatus = 'credited';
      referral.referrerRewardDate = new Date();
    }

    // Mark as completed if both rewards credited
    if (referral.referredUserRewardStatus === 'credited' &&
        referral.referrerRewardStatus === 'credited') {
      referral.status = 'completed';
    }

    await referral.save();

    // Update referral code stats
    await ReferralCode.updateOne(
      { userId: referral.referrerId },
      {
        $inc: { totalReferrals: 1, totalEarnings: referral.referrerRewardAmount }
      }
    );

    return res.status(200).json({
      success: true,
      message: 'First order recorded',
      referrerReward: referral.referrerRewardAmount
    });

  } catch (error) {
    console.error('Record first order error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error recording first order'
    });
  }
};

// ── Helper: Credit Reward to User ──────────────────────────
async function creditReward(userId, amount, referralId, type) {
  try {
    // Add to referral wallet
    await ReferralWallet.updateOne(
      { userId },
      {
        $inc: { balance: amount, total_earned: amount }
      },
      { upsert: true }
    );

    // Log transaction
    await ReferralWalletTransaction.create({
      userId,
      type: 'credit',
      amount,
      description: type === 'referrer' 
        ? 'Referral reward - referred user placed order'
        : 'Welcome referral bonus',
      referralId
    });

    console.log(`✓ Credited ₹${amount} to user ${userId}`);
  } catch (error) {
    console.error('Error crediting reward:', error);
  }
}

// ── Get Referral History ───────────────────────────────────
exports.getReferralHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10 } = req.query;

    const referrals = await Referral.find({ referrerId: userId })
      .populate('referredUserId', 'name email mobileNumber')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Referral.countDocuments({ referrerId: userId });

    const formattedReferrals = referrals.map(ref => ({
      id: ref._id,
      referredUserName: ref.referredUserId.name,
      referredUserEmail: ref.referredUserId.email,
      referredUserPhone: ref.referredUserId.mobileNumber,
      referralDate: ref.createdAt,
      status: ref.status,
      rewardStatus: ref.referrerRewardStatus,
      rewardAmount: ref.referrerRewardAmount,
      firstOrderDate: ref.referredUserFirstOrderDate,
      code: ref.referralCode
    }));

    return res.status(200).json({
      success: true,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
      referrals: formattedReferrals
    });

  } catch (error) {
    console.error('Get referral history error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching referral history'
    });
  }
};

// ── Get Referral Leaderboard ────────────────────────────────
exports.getReferralLeaderboard = async (req, res) => {
  try {
    const topReferrers = await ReferralCode.find({ isActive: true })
      .sort({ totalEarnings: -1 })
      .limit(10)
      .populate('userId', 'name email');

    return res.status(200).json({
      success: true,
      leaderboard: topReferrers.map((ref, idx) => ({
        rank: idx + 1,
        userName: ref.userId.name,
        referralCode: ref.code,
        totalReferrals: ref.totalReferrals,
        totalEarnings: ref.totalEarnings
      }))
    });

  } catch (error) {
    console.error('Get leaderboard error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching leaderboard'
    });
  }
};

// ── Redeem Referral Wallet to Main Wallet ───────────────────
exports.redeemReferralWallet = async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount } = req.body;

    const wallet = await ReferralWallet.findOne({ userId });

    if (!wallet || wallet.balance < amount) {
      return res.status(400).json({
        success: false,
        message: 'Insufficient balance in referral wallet'
      });
    }

    // Debit from referral wallet
    wallet.balance -= amount;
    wallet.total_spent += amount;
    await wallet.save();

    // Credit to main wallet
    await User.updateOne(
      { _id: userId },
      { $inc: { walletBalance: amount } }
    );

    // Log transaction
    await ReferralWalletTransaction.create({
      userId,
      type: 'debit',
      amount,
      description: 'Redeemed to main wallet'
    });

    return res.status(200).json({
      success: true,
      message: 'Amount redeemed successfully',
      newBalance: wallet.balance,
      mainWalletAmount: amount
    });

  } catch (error) {
    console.error('Redeem wallet error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error redeeming wallet'
    });
  }
};
```

### File: `controllers/admin/referralAdminController.js`

```javascript
const ReferralSettings = require('../../models/ReferralSettings');
const ReferralCode = require('../../models/ReferralCode');
const Referral = require('../../models/Referral');

// ── Update Referral Settings ───────────────────────────────
exports.updateSettings = async (req, res) => {
  try {
    const {
      referrerRewardAmount,
      referredUserRewardAmount,
      referrerRewardTrigger,
      referredUserRewardTrigger,
      minOrderValueForReward,
      maxReferralsPerUser,
      referralValidityDays,
      isActive
    } = req.body;

    const settings = await ReferralSettings.findOneAndUpdate(
      {},
      {
        referrer_reward_amount: referrerRewardAmount,
        referred_user_reward_amount: referredUserRewardAmount,
        referrer_reward_trigger: referrerRewardTrigger,
        referred_user_reward_trigger: referredUserRewardTrigger,
        min_order_value_for_reward: minOrderValueForReward,
        max_referrals_per_user: maxReferralsPerUser,
        referral_validity_days: referralValidityDays,
        is_active: isActive,
        updated_by_admin_id: req.admin.id,
        updated_at: new Date()
      },
      { new: true, upsert: true }
    );

    return res.status(200).json({
      success: true,
      message: 'Referral settings updated',
      settings
    });

  } catch (error) {
    console.error('Update settings error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error updating settings'
    });
  }
};

// ── Get Referral Statistics ───────────────────────────────
exports.getStatistics = async (req, res) => {
  try {
    const stats = {
      totalReferralCodes: await ReferralCode.countDocuments(),
      totalReferrals: await Referral.countDocuments(),
      completedReferrals: await Referral.countDocuments({ status: 'completed' }),
      pendingReferrals: await Referral.countDocuments({ status: 'active' }),
      totalRewardsGiven: await Referral.aggregate([
        {
          $match: { referrerRewardStatus: 'credited' }
        },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: '$referrerRewardAmount' }
          }
        }
      ])
    };

    const topReferrers = await ReferralCode.find()
      .sort({ totalEarnings: -1 })
      .limit(5)
      .populate('userId', 'name email totalReferrals totalEarnings');

    return res.status(200).json({
      success: true,
      stats,
      topReferrers
    });

  } catch (error) {
    console.error('Get statistics error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error fetching statistics'
    });
  }
};

// ── Manual Reward Distribution ─────────────────────────────
exports.manuallyDistributeReward = async (req, res) => {
  try {
    const { referralId, type } = req.body; // type: 'referrer' or 'referred_user'

    const referral = await Referral.findById(referralId);

    if (!referral) {
      return res.status(404).json({
        success: false,
        message: 'Referral not found'
      });
    }

    if (type === 'referrer' && referral.referrerRewardStatus === 'credited') {
      return res.status(400).json({
        success: false,
        message: 'Referrer already rewarded'
      });
    }

    if (type === 'referred_user' && referral.referredUserRewardStatus === 'credited') {
      return res.status(400).json({
        success: false,
        message: 'Referred user already rewarded'
      });
    }

    if (type === 'referrer') {
      referral.referrerRewardStatus = 'credited';
      referral.referrerRewardDate = new Date();
    } else {
      referral.referredUserRewardStatus = 'credited';
      referral.referredUserRewardDate = new Date();
    }

    await referral.save();

    return res.status(200).json({
      success: true,
      message: `${type} reward distributed manually`
    });

  } catch (error) {
    console.error('Manual distribution error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error distributing reward'
    });
  }
};
```

### File: `routes/referralRoutes.js`

```javascript
const express = require('express');
const referralController = require('../controllers/referralController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authMiddleware);

router.post('/generate', referralController.generateReferralCode);
router.get('/my-code', referralController.getMyReferralCode);
router.post('/join', referralController.joinWithReferralCode);
router.post('/record-first-order', referralController.recordFirstOrder);
router.get('/history', referralController.getReferralHistory);
router.get('/leaderboard', referralController.getReferralLeaderboard);
router.post('/redeem-wallet', referralController.redeemReferralWallet);

module.exports = router;
```

### File: `routes/admin/referralAdminRoutes.js`

```javascript
const express = require('express');
const referralAdminController = require('../../controllers/admin/referralAdminController');
const adminAuthMiddleware = require('../../middleware/adminAuthMiddleware');

const router = express.Router();

router.use(adminAuthMiddleware);

router.put('/settings', referralAdminController.updateSettings);
router.get('/statistics', referralAdminController.getStatistics);
router.post('/manual-reward', referralAdminController.manuallyDistributeReward);

module.exports = router;
```

---

## Flutter Frontend Implementation

### File: `lib/core/models/referral_model.dart`

```dart
class ReferralCode {
  final String code;
  final double rewardAmount;
  final int totalReferrals;
  final double totalEarnings;
  final double walletBalance;
  final String shareUrl;
  final String deepLink;

  ReferralCode({
    required this.code,
    required this.rewardAmount,
    required this.totalReferrals,
    required this.totalEarnings,
    required this.walletBalance,
    required this.shareUrl,
    required this.deepLink,
  });

  factory ReferralCode.fromJson(Map<String, dynamic> json) {
    return ReferralCode(
      code: json['code'] ?? '',
      rewardAmount: (json['rewardAmount'] as num?)?.toDouble() ?? 0.0,
      totalReferrals: json['totalReferrals'] ?? 0,
      totalEarnings: (json['totalEarnings'] as num?)?.toDouble() ?? 0.0,
      walletBalance: (json['walletBalance'] as num?)?.toDouble() ?? 0.0,
      shareUrl: json['shareUrl'] ?? '',
      deepLink: json['deepLink'] ?? '',
    );
  }
}

class ReferralRecord {
  final String id;
  final String referredUserName;
  final String referredUserEmail;
  final String referredUserPhone;
  final DateTime referralDate;
  final String status; // active, completed, cancelled
  final String rewardStatus; // pending, credited
  final double rewardAmount;
  final DateTime? firstOrderDate;
  final String code;

  ReferralRecord({
    required this.id,
    required this.referredUserName,
    required this.referredUserEmail,
    required this.referredUserPhone,
    required this.referralDate,
    required this.status,
    required this.rewardStatus,
    required this.rewardAmount,
    this.firstOrderDate,
    required this.code,
  });

  factory ReferralRecord.fromJson(Map<String, dynamic> json) {
    return ReferralRecord(
      id: json['id'] ?? '',
      referredUserName: json['referredUserName'] ?? '',
      referredUserEmail: json['referredUserEmail'] ?? '',
      referredUserPhone: json['referredUserPhone'] ?? '',
      referralDate: DateTime.parse(json['referralDate'] ?? DateTime.now().toString()),
      status: json['status'] ?? 'active',
      rewardStatus: json['rewardStatus'] ?? 'pending',
      rewardAmount: (json['rewardAmount'] as num?)?.toDouble() ?? 0.0,
      firstOrderDate: json['firstOrderDate'] != null 
        ? DateTime.parse(json['firstOrderDate']) 
        : null,
      code: json['code'] ?? '',
    );
  }
}

class LeaderboardEntry {
  final int rank;
  final String userName;
  final String referralCode;
  final int totalReferrals;
  final double totalEarnings;

  LeaderboardEntry({
    required this.rank,
    required this.userName,
    required this.referralCode,
    required this.totalReferrals,
    required this.totalEarnings,
  });

  factory LeaderboardEntry.fromJson(Map<String, dynamic> json) {
    return LeaderboardEntry(
      rank: json['rank'] ?? 0,
      userName: json['userName'] ?? '',
      referralCode: json['referralCode'] ?? '',
      totalReferrals: json['totalReferrals'] ?? 0,
      totalEarnings: (json['totalEarnings'] as num?)?.toDouble() ?? 0.0,
    );
  }
}
```

### File: `lib/core/services/referral_service.dart`

```dart
import 'package:dio/dio.dart';
import '../models/referral_model.dart';

class ReferralService {
  final Dio _dio;

  ReferralService(this._dio);

  /// Generate referral code for user
  Future<ReferralCode> generateReferralCode() async {
    try {
      final response = await _dio.post('/referrals/generate');

      if (response.statusCode == 201 || response.statusCode == 200) {
        return ReferralCode.fromJson(response.data['referral'] ?? response.data);
      }

      throw Exception(response.data['message']);
    } on DioException catch (e) {
      throw Exception(e.response?.data['message'] ?? 'Error generating code');
    }
  }

  /// Get user's referral code and stats
  Future<ReferralCode> getMyReferralCode() async {
    try {
      final response = await _dio.get('/referrals/my-code');

      if (response.statusCode == 200) {
        return ReferralCode.fromJson(response.data['referral']);
      }

      throw Exception(response.data['message']);
    } on DioException catch (e) {
      throw Exception(e.response?.data['message'] ?? 'Error fetching code');
    }
  }

  /// Join with referral code (called during signup)
  Future<void> joinWithReferralCode(String code) async {
    try {
      await _dio.post(
        '/referrals/join',
        data: {'referralCode': code},
      );
    } on DioException catch (e) {
      throw Exception(e.response?.data['message'] ?? 'Invalid referral code');
    }
  }

  /// Record first order (call after payment success)
  Future<double?> recordFirstOrder(String orderId, double orderAmount) async {
    try {
      final response = await _dio.post(
        '/referrals/record-first-order',
        data: {
          'orderId': orderId,
          'orderAmount': orderAmount,
        },
      );

      if (response.statusCode == 200 && response.data['success']) {
        return (response.data['referrerReward'] as num?)?.toDouble();
      }

      return null;
    } on DioException catch (e) {
      print('Error recording first order: ${e.message}');
      return null;
    }
  }

  /// Get referral history
  Future<Map<String, dynamic>> getReferralHistory({
    int page = 1,
    int limit = 10,
  }) async {
    try {
      final response = await _dio.get(
        '/referrals/history',
        queryParameters: {'page': page, 'limit': limit},
      );

      if (response.statusCode == 200) {
        return {
          'total': response.data['total'],
          'page': response.data['page'],
          'limit': response.data['limit'],
          'pages': response.data['pages'],
          'referrals': (response.data['referrals'] as List?)
              ?.map((r) => ReferralRecord.fromJson(r))
              .toList() ?? [],
        };
      }

      return {'referrals': []};
    } on DioException catch (e) {
      print('Error fetching history: ${e.message}');
      return {'referrals': []};
    }
  }

  /// Get leaderboard
  Future<List<LeaderboardEntry>> getLeaderboard() async {
    try {
      final response = await _dio.get('/referrals/leaderboard');

      if (response.statusCode == 200) {
        return (response.data['leaderboard'] as List?)
            ?.map((e) => LeaderboardEntry.fromJson(e))
            .toList() ?? [];
      }

      return [];
    } on DioException catch (e) {
      print('Error fetching leaderboard: ${e.message}');
      return [];
    }
  }

  /// Redeem referral wallet to main wallet
  Future<Map<String, dynamic>> redeemWallet(double amount) async {
    try {
      final response = await _dio.post(
        '/referrals/redeem-wallet',
        data: {'amount': amount},
      );

      if (response.statusCode == 200) {
        return {
          'success': true,
          'newBalance': response.data['newBalance'],
          'mainWalletAmount': response.data['mainWalletAmount'],
        };
      }

      throw Exception(response.data['message']);
    } on DioException catch (e) {
      throw Exception(e.response?.data['message'] ?? 'Error redeeming wallet');
    }
  }
}
```

### File: `lib/features/profile/providers/referral_provider.dart`

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/models/referral_model.dart';
import '../../../core/services/referral_service.dart';

final referralServiceProvider = Provider((ref) {
  return ReferralService(ref.watch(dioProvider));
});

// Current user's referral code
final myReferralCodeProvider = FutureProvider((ref) async {
  final service = ref.watch(referralServiceProvider);
  return await service.getMyReferralCode();
});

// Referral history
final referralHistoryProvider = FutureProvider.family<
    Map<String, dynamic>,
    int>((ref, page) async {
  final service = ref.watch(referralServiceProvider);
  return await service.getReferralHistory(page: page, limit: 10);
});

// Leaderboard
final referralLeaderboardProvider = FutureProvider((ref) async {
  final service = ref.watch(referralServiceProvider);
  return await service.getLeaderboard();
});

// Referral wallet balance
final referralWalletProvider = StateNotifierProvider<
    ReferralWalletNotifier,
    double>((ref) {
  return ReferralWalletNotifier(ref.watch(referralServiceProvider));
});

class ReferralWalletNotifier extends StateNotifier<double> {
  final ReferralService _service;

  ReferralWalletNotifier(this._service) : super(0);

  Future<void> redeemWallet(double amount) async {
    try {
      final result = await _service.redeemWallet(amount);
      state = (result['newBalance'] as num?)?.toDouble() ?? 0;
    } catch (e) {
      print('Error redeeming wallet: $e');
    }
  }
}
```

---

## Flutter UI Components (Part 1)

### File: `lib/features/profile/screens/referral_screen.dart`

```dart
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';
import 'package:intl/intl.dart';

class ReferralScreen extends ConsumerStatefulWidget {
  const ReferralScreen({Key? key}) : super(key: key);

  @override
  ConsumerState<ReferralScreen> createState() => _ReferralScreenState();
}

class _ReferralScreenState extends ConsumerState<ReferralScreen> {
  int _selectedTab = 0; // 0: Referrals, 1: Leaderboard, 2: Wallet

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF5F6FA),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: Colors.black87),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: const Text(
          'Referral Program',
          style: TextStyle(
            color: Colors.black87,
            fontWeight: FontWeight.w700,
            fontSize: 18,
          ),
        ),
        centerTitle: false,
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(1),
          child: Divider(height: 1, color: Colors.grey.shade200),
        ),
      ),
      body: SingleChildScrollView(
        child: Column(
          children: [
            // ── Your Referral Code Card ──
            _buildReferralCodeCard(),

            const SizedBox(height: 20),

            // ── Tabs ──
            _buildTabs(),

            const SizedBox(height: 12),

            // ── Tab Content ──
            if (_selectedTab == 0) _buildReferralsTab(),
            if (_selectedTab == 1) _buildLeaderboardTab(),
            if (_selectedTab == 2) _buildWalletTab(),
          ],
        ),
      ),
    );
  }

  // ── Referral Code Card ──
  Widget _buildReferralCodeCard() {
    return ref.watch(myReferralCodeProvider).when(
      data: (referralCode) => Container(
        margin: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [Color(0xFF2453FF), Color(0xFF1A3FCC)],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: const Color(0xFF2453FF).withOpacity(0.3),
              blurRadius: 12,
              offset: const Offset(0, 4),
            )
          ],
        ),
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Your Referral Code',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w600,
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 12),

            // Code Display
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        referralCode.code,
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                          fontSize: 24,
                          fontFamily: 'Courier',
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Share to earn ₹${referralCode.rewardAmount.toStringAsFixed(0)} per referral',
                        style: TextStyle(
                          color: Colors.white.withOpacity(0.8),
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                Column(
                  children: [
                    GestureDetector(
                      onTap: () {
                        Clipboard.setData(
                          ClipboardData(text: referralCode.code),
                        );
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Code copied!')),
                        );
                      },
                      child: Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Icon(
                          Icons.copy,
                          color: Colors.white,
                          size: 20,
                        ),
                      ),
                    ),
                    const SizedBox(height: 8),
                    GestureDetector(
                      onTap: () {
                        Share.share(
                          'Join LaundryBrew using my referral code: ${referralCode.code}\nGet ₹${referralCode.rewardAmount.toStringAsFixed(0)} off your first order!\n\n${referralCode.shareUrl}',
                          subject: 'Join LaundryBrew - Get ₹${referralCode.rewardAmount.toStringAsFixed(0)} OFF',
                        );
                      },
                      child: Container(
                        padding: const EdgeInsets.all(10),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Icon(
                          Icons.share,
                          color: Colors.white,
                          size: 20,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),

            const SizedBox(height: 20),

            // Stats Row
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: [
                _buildStatColumn(
                  label: 'Referrals',
                  value: referralCode.totalReferrals.toString(),
                ),
                Container(
                  width: 1,
                  height: 40,
                  color: Colors.white.withOpacity(0.3),
                ),
                _buildStatColumn(
                  label: 'Earnings',
                  value: '₹${referralCode.totalEarnings.toStringAsFixed(0)}',
                ),
                Container(
                  width: 1,
                  height: 40,
                  color: Colors.white.withOpacity(0.3),
                ),
                _buildStatColumn(
                  label: 'Wallet',
                  value: '₹${referralCode.walletBalance.toStringAsFixed(0)}',
                ),
              ],
            ),
          ],
        ),
      ),
      loading: () => Container(
        margin: const EdgeInsets.all(16),
        height: 200,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
        ),
        child: const Center(
          child: CircularProgressIndicator(),
        ),
      ),
      error: (err, _) => Center(
        child: Text('Error loading referral code: $err'),
      ),
    );
  }

  // ── Tabs ──
  Widget _buildTabs() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.grey.shade300),
      ),
      child: Row(
        children: [
          _buildTab(0, 'Referrals'),
          _buildTab(1, 'Leaderboard'),
          _buildTab(2, 'Wallet'),
        ],
      ),
    );
  }

  Widget _buildTab(int index, String label) {
    final isSelected = _selectedTab == index;

    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _selectedTab = index),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            color: isSelected ? const Color(0xFF2453FF) : Colors.transparent,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: 13,
                color: isSelected ? Colors.white : Colors.black54,
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ── Referrals Tab ──
  Widget _buildReferralsTab() {
    return ref.watch(referralHistoryProvider(1)).when(
      data: (historyMap) {
        final referrals = (historyMap['referrals'] as List?)?.cast<ReferralRecord>() ?? [];

        if (referrals.isEmpty) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                children: [
                  Icon(
                    Icons.people_outline,
                    size: 64,
                    color: Colors.grey.shade400,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'No referrals yet',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: Colors.grey.shade600,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Share your code to start earning',
                    style: TextStyle(
                      fontSize: 13,
                      color: Colors.grey.shade500,
                    ),
                  ),
                ],
              ),
            ),
          );
        }

        return ListView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          padding: const EdgeInsets.all(16),
          itemCount: referrals.length,
          itemBuilder: (context, index) {
            final referral = referrals[index];
            return Container(
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.grey.shade200),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              referral.referredUserName,
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                                fontSize: 14,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              referral.referredUserEmail,
                              style: TextStyle(
                                fontSize: 12,
                                color: Colors.grey.shade600,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: referral.rewardStatus == 'credited'
                              ? Colors.green.shade50
                              : Colors.orange.shade50,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(
                          referral.rewardStatus == 'credited'
                              ? '✓ Credited'
                              : '⏳ Pending',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: referral.rewardStatus == 'credited'
                                ? Colors.green.shade700
                                : Colors.orange.shade700,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Referred: ${DateFormat('dd MMM yyyy').format(referral.referralDate)}',
                        style: TextStyle(
                          fontSize: 11,
                          color: Colors.grey.shade600,
                        ),
                      ),
                      Text(
                        '+₹${referral.rewardAmount.toStringAsFixed(0)}',
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: 12,
                          color: Color(0xFF16A34A),
                        ),
                      ),
                    ],
                  ),
                  if (referral.firstOrderDate != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        'First Order: ${DateFormat('dd MMM yyyy').format(referral.firstOrderDate!)}',
                        style: TextStyle(
                          fontSize: 11,
                          color: Colors.blue.shade600,
                        ),
                      ),
                    ),
                ],
              ),
            );
          },
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => Center(child: Text('Error: $err')),
    );
  }

  // ── Leaderboard Tab ──
  Widget _buildLeaderboardTab() {
    return ref.watch(referralLeaderboardProvider).when(
      data: (leaderboard) => ListView.builder(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        itemCount: leaderboard.length,
        itemBuilder: (context, index) {
          final entry = leaderboard[index];
          final isTopThree = entry.rank <= 3;

          return Container(
            margin: const EdgeInsets.only(bottom: 12),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(8),
              border: isTopThree
                  ? Border.all(
                      color: entry.rank == 1
                          ? Colors.amber
                          : entry.rank == 2
                              ? Colors.grey.shade400
                              : Colors.orange.shade300,
                      width: 2,
                    )
                  : Border.all(color: Colors.grey.shade200),
            ),
            padding: const EdgeInsets.all(12),
            child: Row(
              children: [
                // Rank Badge
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: isTopThree
                        ? entry.rank == 1
                            ? Colors.amber.shade100
                            : entry.rank == 2
                                ? Colors.grey.shade200
                                : Colors.orange.shade100
                        : Colors.grey.shade100,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Center(
                    child: Text(
                      isTopThree
                          ? entry.rank == 1
                              ? '🥇'
                              : entry.rank == 2
                                  ? '🥈'
                                  : '🥉'
                          : '${entry.rank}',
                      style: const TextStyle(fontSize: 18),
                    ),
                  ),
                ),
                const SizedBox(width: 12),

                // Name & Code
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        entry.userName,
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 14,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        entry.referralCode,
                        style: TextStyle(
                          fontSize: 11,
                          color: Colors.grey.shade600,
                          fontFamily: 'Courier',
                        ),
                      ),
                    ],
                  ),
                ),

                // Stats
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      entry.totalReferrals.toString(),
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                        color: Color(0xFF2453FF),
                      ),
                    ),
                    Text(
                      'referrals',
                      style: TextStyle(
                        fontSize: 10,
                        color: Colors.grey.shade600,
                      ),
                    ),
                  ],
                ),
                const SizedBox(width: 12),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text(
                      '₹${entry.totalEarnings.toStringAsFixed(0)}',
                      style: const TextStyle(
                        fontWeight: FontWeight.w700,
                        fontSize: 14,
                        color: Color(0xFF16A34A),
                      ),
                    ),
                    Text(
                      'earned',
                      style: TextStyle(
                        fontSize: 10,
                        color: Colors.grey.shade600,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          );
        },
      ),
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => Center(child: Text('Error: $err')),
    );
  }

  // ── Wallet Tab ──
  Widget _buildWalletTab() {
    return ref.watch(myReferralCodeProvider).when(
      data: (referralCode) => Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            // Wallet Balance Card
            Container(
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Color(0xFF16A34A), Color(0xFF059669)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(16),
              ),
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Referral Wallet Balance',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w600,
                      fontSize: 13,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Text(
                    '₹${referralCode.walletBalance.toStringAsFixed(2)}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                      fontSize: 36,
                    ),
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: referralCode.walletBalance > 0
                          ? () => _showRedeemDialog(referralCode.walletBalance)
                          : null,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.white,
                        disabledBackgroundColor: Colors.white.withOpacity(0.5),
                        elevation: 0,
                        padding: const EdgeInsets.symmetric(vertical: 12),
                      ),
                      child: Text(
                        'Redeem to Main Wallet',
                        style: TextStyle(
                          color: referralCode.walletBalance > 0
                              ? const Color(0xFF16A34A)
                              : Colors.grey.shade400,
                          fontWeight: FontWeight.w700,
                          fontSize: 14,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),

            const SizedBox(height: 20),

            // Info Card
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.blue.shade50,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.blue.shade200),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.info,
                    color: Colors.blue.shade700,
                    size: 20,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      'You can redeem your referral wallet balance to your main wallet anytime. Use it for payments!',
                      style: TextStyle(
                        fontSize: 12,
                        color: Colors.blue.shade700,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (err, _) => Center(child: Text('Error: $err')),
    );
  }

  // ── Helper: Stat Column ──
  Widget _buildStatColumn({required String label, required String value}) {
    return Column(
      children: [
        Text(
          value,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w800,
            fontSize: 20,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: TextStyle(
            color: Colors.white.withOpacity(0.8),
            fontSize: 11,
          ),
        ),
      ],
    );
  }

  // ── Show Redeem Dialog ──
  void _showRedeemDialog(double maxAmount) {
    final controller = TextEditingController();

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Redeem Wallet'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: controller,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                hintText: 'Enter amount',
                helperText: 'Available: ₹${maxAmount.toStringAsFixed(2)}',
                border: const OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              final amount = double.tryParse(controller.text);
              if (amount != null && amount > 0 && amount <= maxAmount) {
                ref.read(referralWalletProvider.notifier).redeemWallet(amount);
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('₹${amount.toStringAsFixed(2)} redeemed!'),
                    backgroundColor: Colors.green,
                  ),
                );
              }
            },
            child: const Text('Redeem'),
          ),
        ],
      ),
    );
  }
}
```

---

This is **Part 1** of the Referral System. In the next message, I'll provide:
- Part 2: Sign-up integration
- Part 3: Payment integration  
- Part 4: Admin dashboard
- Part 5: Quick setup guide

Would you like me to continue with **Part 2** right now? 🚀
