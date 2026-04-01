const mongoose = require('mongoose');

const DrugSchema = new mongoose.Schema({
  // Original fields
  name: { type: String, required: true },
  genericName: { type: String },
  description: { type: String },
  category: { type: String },
  manufacturer: { type: String },
  dosageForm: { type: String }, // tablet, capsule, syrup, injection, etc.
  strength: { type: String }, // e.g., "500mg", "10ml"
  activeIngredients: [{ type: String }],
  contraindications: [{ type: String }],
  sideEffects: [{ type: String }],
  
  // Fields from Excel file (Arabic column names mapped to English)
  itemId: { type: String, unique: true, sparse: true }, // رقم الصنف
  barcode: { type: String, sparse: true }, // بار كود - not unique to allow empty values
  currentQuantity: { type: Number, default: 0 }, // ك.حالية
  mainSupplier: { type: String }, // اسم المورد الرئيسي
  lastPurchasePrice: { type: Number }, // اخر سعر شراء
  purchasePriceCurrency: { type: String, default: 'شيقل' }, // عملة أخر سعر شراء
  unitSellingPrice: { type: Number }, // سعر بيع الوحدة الرئيسية
  lastUpdateDate: { type: Date }, // التاريخ
  sellingPriceCurrency: { type: String, default: 'شيقل' }, // عملة سعر بيع الوحدة الرئيسية
  wholesalePrice: { type: Number, default: 0 }, // سعر البيع جملة
  isFrozen: { type: Boolean, default: false }, // الصنف مجمد
  warehouse: { type: String, default: 'Main Store' }, // المستودع
  bulkWholesalePrice: { type: Number, default: 0 }, // سعر بيع جملة الجملة
  hasAlternatives: { type: Boolean, default: false }, // له بدائل
  hasFollowups: { type: Boolean, default: false }, // له توابع
  
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

// Create indexes for faster lookups
DrugSchema.index({ itemId: 1 });
DrugSchema.index({ barcode: 1 });
DrugSchema.index({ name: 1 });

module.exports = mongoose.model('Drug', DrugSchema);
