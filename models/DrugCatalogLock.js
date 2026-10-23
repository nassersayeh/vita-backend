const mongoose = require('mongoose');
// _id is unique even before optional secondary indexes are built.
module.exports = mongoose.model('DrugCatalogLock', new mongoose.Schema({
  _id: String, token: String, expiresAt: Date,
}));
