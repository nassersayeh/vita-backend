const mongoose = require('mongoose');

const ItemSchema = new mongoose.Schema({
  onModel: {
    type: String,
    required: true,
    enum: ['Product', 'EPrescription']
  },
  item: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'items.onModel'
  },
  quantity: {
    type: Number,
    required: true,
    min: 1,
    default: 1
  },
  name: { type: String, required: true }, // Added for store items
  price: { type: Number, required: true }, // Added for store items
  details: { type: mongoose.Schema.Types.Mixed }, // Full item details (barcode, inventoryId, drugId, etc.)
  prescriptionDetails: { // Added for ePrescriptions
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    doctorName: String,
    date: Date,
    doses: String,
    products: [{
      name: String,
      dose: String
    }]
  }
}, { _id: false });

const OrderSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  pharmacyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  city: { type: String, trim: true },
  items: { type: [ItemSchema], default: [] },
  total: { type: Number, required: true },
  subtotal: { type: Number },
  taxAmount: { type: Number, default: 0 },
  vatApplied: { type: Boolean, default: false },
  vatRate: { type: Number, default: 0 },
  status: { type: String, enum: ['pending', 'accepted', 'declined', 'preparing', 'ready', 'delivery_assigned', 'shipped', 'delivered', 'completed', 'cancelled', 'paid'], default: 'pending' },
  // Status tracking timestamps
  acceptedAt: { type: Date },
  preparingStartedAt: { type: Date },
  deliveryAssignedAt: { type: Date },
  shippedAt: { type: Date },
  deliveredAt: { type: Date },
  // Status history for audit trail
  statusHistory: [{
    status: String,
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: String
  }],
  // Delivery assignment info
  assignedDeliveryPerson: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  trackingNumber: String,
  paymentMethod: { type: String, enum: ['Cash', 'Card', 'Insurance', 'ReflectVisa'], default: 'Cash' },
  insuranceCompany: { type: String },
  // New fields for prescription handling
  orderType: { type: String, enum: ['prescription', 'upload', 'manual'], default: 'manual' },
  prescriptionId: { type: mongoose.Schema.Types.ObjectId, ref: 'EPrescription' },
  prescriptionImage: { 
    filename: String,
    filePath: String,
    fileUrl: String,
    uploadedAt: Date
  },
  prescriptionNotes: String,
  prescriptionRequested: { type: Boolean, default: false },
  prescriptionRequestedAt: { type: Date },
  // Delivery
  deliveryMethod: { type: String, enum: ['delivery', 'pickup'], default: 'pickup' },
  deliveryAddress: {
    label: String,
    city: String,
    street: String,
    building: String,
    floor: String,
    apartment: String,
    phone: String,
    notes: String,
  },
}, { timestamps: true });

module.exports = mongoose.model('Order', OrderSchema);
