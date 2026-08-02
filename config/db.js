
/* ============================================================
   FILE: config/db.js  —  MongoDB Connection (Local + Atlas)
   ============================================================ */
// config/db.js
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const uri = process.env.MONGO_URI;
    const options = {
      serverSelectionTimeoutMS : 5000,
      socketTimeoutMS          : 45000,
    };

    const conn = await mongoose.connect(uri, options);

    console.log(`✅ MongoDB connected: ${conn.connection.host}`);
    console.log(`   DB Name: ${conn.connection.name}`);

    /* Connection event listeners */
    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️  MongoDB disconnected. Attempting reconnect…');
    });
    mongoose.connection.on('reconnected', () => {
      console.log('✅ MongoDB reconnected');
    });
    mongoose.connection.on('error', (err) => {
      console.error('❌ MongoDB connection error:', err);
    });

  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
