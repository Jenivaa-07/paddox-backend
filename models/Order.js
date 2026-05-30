/* ============================================================
   FILE: models/Order.js
   PADDOX — FIXED ORDER MODEL
   Fixes checkout error: "next is not a function"
   ============================================================ */

const mongoose = require('mongoose');
const Counter = require('./Counter');

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  image: String,
  price: {
    type: Number,
    required: true
  },
  originalPrice: {
    type: Number,
    default: 0
  },
  productDiscount: {
    type: Number,
    default: 0
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  size: String,
  color: String,
  customisation: String
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true
  },

  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  items: {
    type: [orderItemSchema],
    required: true
  },

  shippingAddress: {
    name: {
      type: String,
      required: true
    },
    line1: {
      type: String,
      required: true
    },
    line2: String,
    city: {
      type: String,
      required: true
    },
    state: {
      type: String,
      required: true
    },
    pincode: {
      type: String,
      required: true
    },
    country: {
      type: String,
      default: 'India'
    },
    phone: {
      type: String,
      required: true
    }
  },

  pricing: {
    subtotal: {
      type: Number,
      required: true
    },
    shipping: {
      type: Number,
      default: 0
    },
    productDiscount: {
      type: Number,
      default: 0
    },
    discount: {
      type: Number,
      default: 0
    },
    totalDiscount: {
      type: Number,
      default: 0
    },
    tax: {
      type: Number,
      default: 0
    },
    total: {
      type: Number,
      required: true
    }
  },



  coupon: {
    code: {
      type: String,
      uppercase: true,
      trim: true,
      default: ''
    },
    type: {
      type: String,
      enum: ['percent', 'fixed', ''],
      default: ''
    },
    value: {
      type: Number,
      default: 0
    },
    discount: {
      type: Number,
      default: 0
    }
  },

  payment: {
    method: {
      type: String,
      enum: ['upi', 'card', 'netbanking', 'wallet', 'cod', 'razorpay'],
      default: 'upi'
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed', 'refunded'],
      default: 'pending'
    },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    razorpaySignature: String,
    paidAt: Date
  },

  status: {
    type: String,
    enum: [
      'placed',
      'processing',
      'shipped',
      'out_for_delivery',
      'delivered',
      'cancelled',
      'refunded'
    ],
    default: 'placed'
  },

  tracking: {
    carrier: String,
    trackingNumber: String,
    estimatedDate: Date
  },

  statusHistory: [{
    status: String,
    message: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],

  notes: String,
  cancelReason: String
}, { timestamps: true });

/* Auto-generate order number
   Uses an atomic counter instead of countDocuments().
   This prevents duplicate order numbers like PDX-00006 when
   orders are deleted, created quickly, or placed concurrently.
*/
orderSchema.pre('save', async function () {
  if (!this.isNew) return;

  if (!this.orderNumber) {
    let counter = await Counter.findOneAndUpdate(
      { key: 'orders' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    /* First install safety:
       If the counter is new but old orders already exist,
       jump the counter above the latest existing PDX number. */
    if (Number(counter.seq || 0) === 1) {
      const latestOrder = await mongoose.model('Order')
        .findOne({ orderNumber: /^PDX-\d+$/ })
        .sort({ orderNumber: -1 })
        .select('orderNumber')
        .lean();

      const latestNumber = latestOrder?.orderNumber
        ? Number(String(latestOrder.orderNumber).replace('PDX-', ''))
        : 0;

      if (Number.isFinite(latestNumber) && latestNumber >= counter.seq) {
        counter = await Counter.findOneAndUpdate(
          { key: 'orders' },
          { $max: { seq: latestNumber + 1 } },
          { new: true, upsert: true }
        );
      }
    }

    this.orderNumber = `PDX-${String(counter.seq).padStart(5, '0')}`;
  }

  if (!Array.isArray(this.statusHistory)) {
    this.statusHistory = [];
  }

  this.statusHistory.push({
    status: 'placed',
    message: 'Order placed successfully'
  });
});

orderSchema.index({
  user: 1,
  createdAt: -1
});

orderSchema.index({
  status: 1
});

module.exports =
  mongoose.models.Order ||
  mongoose.model('Order', orderSchema);
