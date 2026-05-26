/* ============================================================
   FILE: models/Order.js
   PADDOX — FIXED ORDER MODEL
   Fixes checkout error: "next is not a function"
   ============================================================ */

const mongoose = require('mongoose');

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
    discount: {
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
   IMPORTANT:
   Do NOT use next() here.
   Mongoose async middleware returns automatically.
*/
orderSchema.pre('save', async function () {
  if (!this.isNew) return;

  if (!this.orderNumber) {
    const count = await mongoose.model('Order').countDocuments();

    this.orderNumber =
      `PDX-${String(count + 1).padStart(5, '0')}`;
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
