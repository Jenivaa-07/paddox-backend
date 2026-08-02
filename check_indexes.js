const mongoose = require('mongoose');
const UserCollectible = require('./models/UserCollectible');

async function checkIndexes() {
  await mongoose.connect('mongodb://127.0.0.1:27017/paddox_test_db');
  console.log("Indexes for UserCollectible:");
  const indexes = await UserCollectible.collection.indexes();
  console.log(JSON.stringify(indexes, null, 2));
  mongoose.connection.close();
}
checkIndexes();
