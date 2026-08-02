/* ============================================================
   FILE: models/User.js
   PADDOX — User Model
   Phase A4.7C.4: Email 2FA + Trusted Sessions
   ============================================================ */
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const sessionSchema = new mongoose.Schema({
  sessionId: { type:String, default:'' },
  browser  : { type:String, default:'Browser' },
  device   : { type:String, default:'Desktop' },
  ip       : { type:String, default:'' },
  userAgent: { type:String, default:'' },
  lastSeen : { type:Date, default:Date.now },
  createdAt: { type:Date, default:Date.now },
  revoked  : { type:Boolean, default:false }
}, { _id:false });

const userSchema = new mongoose.Schema({
  firstName    : { type:String, required:[true,'First name required'], trim:true, maxlength:50 },
  lastName     : { type:String, trim:true, maxlength:50 },
  email        : { type:String, required:[true,'Email required'], unique:true, lowercase:true, trim:true, match:[/^\S+@\S+\.\S+$/,'Invalid email'] },
  password     : { type:String, required:[true,'Password required'], minlength:6, select:false },
  role         : { type:String, enum:['user','admin'], default:'user' },
  avatar       : { url:{ type:String, default:'' }, publicId:{ type:String, default:'' } },
  phone        : { type:String, trim:true },
  dateOfBirth  : { type:Date },
  address      : {
    line1:String, line2:String,
    city:String, state:String,
    pincode:String, country:{ type:String, default:'India' }
  },
  preferences  : {
    favouriteTeam  : { type:String, default:'' },
    favouriteDriver: { type:String, default:'' },
    newsletter     : { type:Boolean, default:true },
  },
  notifications : {
    raceAlerts   : { type:Boolean, default:true },
    newDrops     : { type:Boolean, default:true },
    orderUpdates : { type:Boolean, default:true },
    fanPoints    : { type:Boolean, default:false },
    community    : { type:Boolean, default:false },
  },
  security: {
    twoFactor: {
      enabled: { type:Boolean, default:false },
      codeHash: { type:String, default:'' },
      codeExpires: { type:Date },
      pendingAction: { type:String, enum:['enable','disable','login',''], default:'' },
      lastSentAt: { type:Date },
      enabledAt: { type:Date }
    },
    sessions: { type:[sessionSchema], default:[] }
  },
  fanPoints    : { type:Number, default:0 },
  fanTier      : { type:String, enum:['Regular','Pro Fan','Elite Fan','Legend'], default:'Regular' },

  /* Phase A4.11A — PADDOX AI Credits wallet
     Fan Points = reputation/ranking.
     AI Credits = spendable balance for AI Fan Studio generation. */
  aiCredits    : { type:Number, default:50, min:0 },
  refreshToken : { type:String, select:false },
  isBanned     : { type:Boolean, default:false },
  isVerified   : { type:Boolean, default:false },
  lastLogin    : { type:Date },
  resetPasswordToken  : String,
  resetPasswordExpire : Date,
}, { timestamps:true });

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.matchPassword = async function(entered) {
  return await bcrypt.compare(entered, this.password);
};

userSchema.methods.updateFanTier = function() {
  if      (this.fanPoints >= 10000) this.fanTier = 'Legend';
  else if (this.fanPoints >= 5000)  this.fanTier = 'Elite Fan';
  else if (this.fanPoints >= 1000)  this.fanTier = 'Pro Fan';
  else                               this.fanTier = 'Regular';
};

userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName || ''}`.trim();
});

module.exports = mongoose.model('User', userSchema);
