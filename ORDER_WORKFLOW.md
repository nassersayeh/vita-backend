# Order Status Workflow with Browser Notifications

## Overview
This document describes the complete order status workflow implemented in Vita Healthcare System, with real-time browser notifications and audit trail tracking.

## Status Flow

```
pending
  ├─→ accepted
  │     ├─→ preparing
  │     │     ├─→ ready
  │     │     │     ├─→ delivery_assigned
  │     │     │     │     ├─→ shipped
  │     │     │     │     │     ├─→ delivered
  │     │     │     │     │     │     ├─→ completed
  │     │     │     │     │     │     └─→ cancelled
  │     │     │     │     │     └─→ cancelled
  │     │     │     │     └─→ cancelled
  │     │     │     └─→ cancelled
  │     │     └─→ cancelled
  │     └─→ cancelled
  ├─→ declined
  └─→ cancelled
```

## Timestamps Tracked

Each status transition automatically records a timestamp:

- **acceptedAt** - When order is accepted by pharmacy/admin
- **preparingStartedAt** - When staff starts preparing the order
- **deliveryAssignedAt** - When delivery person is assigned
- **shippedAt** - When order is shipped to patient
- **deliveredAt** - When order is delivered to patient

## Status History

Every status change is recorded in the `statusHistory` array with:

```javascript
{
  status: String,          // The status changed to
  changedAt: Date,         // When the change occurred
  changedBy: ObjectId,     // User ID who made the change
  notes: String           // Optional notes about the change
}
```

### Example Status History
```javascript
{
  statusHistory: [
    {
      status: 'accepted',
      changedAt: 2024-01-15T10:30:00Z,
      changedBy: ObjectId("5f7a3c2b1d4e5a9c8b0f1g2h"),
      notes: null
    },
    {
      status: 'preparing',
      changedAt: 2024-01-15T10:35:00Z,
      changedBy: ObjectId("5f7a3c2b1d4e5a9c8b0f1g2h"),
      notes: null
    },
    {
      status: 'shipped',
      changedAt: 2024-01-15T11:00:00Z,
      changedBy: ObjectId("5f7a3c2b1d4e5a9c8b0f1g3i"),
      notes: "Handed to delivery person Ahmad"
    }
  ]
}
```

## Browser Notifications

### Frontend Implementation

**Location:** `/src/pages/pharmacy/OrdersPage.jsx`

#### Initialization
```javascript
const initializeNotifications = async () => {
  const permission = await notificationService.requestPermission();
  if (permission === 'granted') {
    setNotificationsEnabled(true);
  }
};
```

#### Triggering Notifications
When status is updated, a browser notification is sent:

```javascript
const handleUpdateStatus = async (orderId, status) => {
  await apiService.orders.updateStatus(orderId, status);
  
  if (notificationsEnabled) {
    notificationService.sendOrderNotification(orderId, status, message);
  }
};
```

#### Status Messages (Arabic)
- **pending**: "📋 طلب جديد" (New Order)
- **accepted**: "✓ تم قبول الطلب" (Order Accepted)
- **preparing**: "⚙️ جاري التحضير" (Preparing)
- **ready**: "📦 الطلب جاهز" (Ready)
- **delivery_assigned**: "🚚 تم تعيين المندوب" (Delivery Assigned)
- **shipped**: "📤 تم الإرسال" (Shipped)
- **delivered**: "✔️ تم التسليم" (Delivered)
- **completed**: "🎉 اكتمل" (Completed)
- **cancelled**: "❌ ألغي" (Cancelled)

### Notification Service

**Location:** `/src/services/notificationService.js`

Key functions:
- `requestPermission()` - Get browser notification permissions
- `sendNotification(title, options)` - Send browser push notification
- `sendOrderNotification(orderId, status, message)` - Status-specific notification

## Backend Implementation

### Order Model Updates

**Location:** `/models/Order.js`

Added fields:
```javascript
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

// Delivery info
assignedDeliveryPerson: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
trackingNumber: String
```

### Controller Updates

**Location:** `/controllers/orderController.js`

The `updateOrderStatus` endpoint now:

1. Validates status transitions based on current status
2. Sets appropriate timestamp fields
3. Records status change in statusHistory array
4. Sends WhatsApp/in-app notifications to patient
5. Handles financial records for accepted orders
6. Updates inventory when status changes

### Valid Status Transitions

```javascript
const validTransitions = {
  pending: ['accepted', 'declined', 'cancelled'],
  accepted: ['preparing', 'ready', 'delivery_assigned', 'cancelled'],
  preparing: ['ready', 'delivery_assigned', 'cancelled'],
  ready: ['delivery_assigned', 'shipped', 'delivered', 'cancelled'],
  delivery_assigned: ['shipped', 'delivered', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: ['completed', 'cancelled'],
  completed: []
};
```

## API Endpoint

### Update Order Status

**Endpoint:** `PUT /orders/{orderId}/status`

**Request Body:**
```json
{
  "status": "accepted",
  "notes": "Optional notes about the status change",
  "changedBy": "Optional user ID (will use req.user if not provided)"
}
```

**Response:**
```json
{
  "message": "تم تحديث حالة الطلب بنجاح",
  "order": {
    "_id": "...",
    "status": "accepted",
    "acceptedAt": "2024-01-15T10:30:00Z",
    "statusHistory": [...],
    ...
  },
  "previousStatus": "pending",
  "newStatus": "accepted"
}
```

## Frontend Components

### OrdersPage.jsx Features

1. **Status Display**
   - Color-coded status badges
   - Icons for each status
   - Status counters in tabs

2. **Action Buttons**
   - Context-aware buttons based on current status
   - Direct status transition buttons
   - Delivery person assignment option

3. **Notifications Panel**
   - Enable/Disable toggle button
   - Real-time browser notifications when enabled
   - Permission request on first use

### Status Colors

- **pending**: Yellow (bg-yellow-100, text-yellow-800)
- **accepted**: Blue (bg-blue-100, text-blue-800)
- **preparing**: Purple (bg-purple-100, text-purple-800)
- **ready**: Green (bg-green-100, text-green-800)
- **delivery_assigned**: Indigo (bg-indigo-100, text-indigo-800)
- **shipped**: Cyan (bg-cyan-100, text-cyan-800)
- **delivered**: Emerald (bg-emerald-100, text-emerald-800)
- **completed**: Gray (bg-gray-100, text-gray-800)
- **cancelled**: Red (bg-red-100, text-red-800)

## Notifications Sent

### When Status Changes to 'accepted'
- ✓ In-app notification to patient
- ✓ WhatsApp message with order details
- ✓ Financial transaction created (if pharmacy order)
- ✓ Browser notification (if enabled)

### When Status Changes to 'preparing'
- ✓ In-app notification to patient
- ✓ WhatsApp message with status update
- ✓ Browser notification (if enabled)

### When Status Changes to 'ready'
- ✓ In-app notification to patient
- ✓ WhatsApp message with full order summary
- ✓ Browser notification (if enabled)

### Other Status Changes
- ✓ In-app notification to patient
- ✓ Browser notification (if enabled)

## Testing

To test the order workflow manually:

1. **Admin Dashboard:**
   - Navigate to pharmacy orders page
   - Click "تفعيل الإشعارات" button to enable notifications
   - Open an order in pending status
   - Click action buttons to transition through statuses
   - Observe browser notifications appearing

2. **Check Database:**
   ```bash
   # View order with all tracking details
   db.orders.findOne({ _id: ObjectId("...") })
   
   # Expected output includes:
   # - acceptedAt, preparingStartedAt, etc. timestamps
   # - statusHistory array with full audit trail
   # - assignedDeliveryPerson, trackingNumber
   ```

## Future Enhancements

1. **Patient App Integration**
   - Display order status timeline with timestamps
   - Real-time order tracking
   - Estimated delivery time calculation

2. **Delivery Tracking**
   - GPS tracking for delivery person
   - Live location updates
   - Estimated arrival time

3. **Advanced Notifications**
   - Firebase Cloud Messaging for mobile apps
   - Email notifications for important status changes
   - SMS notifications for delivery updates

4. **Reporting**
   - Average time per status (e.g., avg preparation time)
   - Status transition analytics
   - Delivery performance metrics

## Notes

- All timestamps are stored in UTC (Z format)
- Status history provides complete audit trail
- Browser notifications require user permission
- Notifications work only in supported browsers (Chrome, Firefox, Edge)
- Service Worker required for background notifications
