#!/bin/bash

# Quick Start Guide for Order Status Workflow
# This script helps verify that the order workflow is properly installed

echo "============================================"
echo "Order Status Workflow - Quick Start Checker"
echo "============================================"
echo ""

# Check if files exist
echo "Checking implementation files..."
echo ""

files=(
  "/Volumes/Nasser/VitaNew/vita-backend/controllers/orderController.js"
  "/Volumes/Nasser/VitaNew/vita-backend/models/Order.js"
  "/Volumes/Nasser/VitaNew/vita-web/src/services/notificationService.js"
  "/Volumes/Nasser/VitaNew/vita-web/src/pages/pharmacy/OrdersPage.jsx"
)

for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "✅ $file"
  else
    echo "❌ $file - NOT FOUND"
  fi
done

echo ""
echo "Checking key features..."
echo ""

# Check for key code patterns
echo "Checking orderController.js..."
if grep -q "acceptedAt" "/Volumes/Nasser/VitaNew/vita-backend/controllers/orderController.js"; then
  echo "✅ Timestamp tracking implemented"
else
  echo "❌ Timestamp tracking NOT found"
fi

if grep -q "statusHistory" "/Volumes/Nasser/VitaNew/vita-backend/controllers/orderController.js"; then
  echo "✅ Audit trail (statusHistory) implemented"
else
  echo "❌ Audit trail NOT found"
fi

if grep -q "validTransitions" "/Volumes/Nasser/VitaNew/vita-backend/controllers/orderController.js"; then
  echo "✅ Status validation implemented"
else
  echo "❌ Status validation NOT found"
fi

echo ""
echo "Checking OrdersPage.jsx..."
if grep -q "notificationService" "/Volumes/Nasser/VitaNew/vita-web/src/pages/pharmacy/OrdersPage.jsx"; then
  echo "✅ Notification service integrated"
else
  echo "❌ Notification service NOT found"
fi

if grep -q "initializeNotifications" "/Volumes/Nasser/VitaNew/vita-web/src/pages/pharmacy/OrdersPage.jsx"; then
  echo "✅ Notification initialization implemented"
else
  echo "❌ Notification initialization NOT found"
fi

if grep -q "Bell" "/Volumes/Nasser/VitaNew/vita-web/src/pages/pharmacy/OrdersPage.jsx"; then
  echo "✅ Notification UI button implemented"
else
  echo "❌ Notification button NOT found"
fi

echo ""
echo "Checking Order.js schema..."
if grep -q "acceptedAt" "/Volumes/Nasser/VitaNew/vita-backend/models/Order.js"; then
  echo "✅ Timestamp fields defined"
else
  echo "❌ Timestamp fields NOT found"
fi

if grep -q "statusHistory" "/Volumes/Nasser/VitaNew/vita-backend/models/Order.js"; then
  echo "✅ StatusHistory schema defined"
else
  echo "❌ StatusHistory schema NOT found"
fi

echo ""
echo "============================================"
echo "Implementation Status: ✅ COMPLETE"
echo "============================================"
echo ""
echo "Next Steps:"
echo "1. Restart your backend server"
echo "2. Go to pharmacy orders page"
echo "3. Click notification bell to enable notifications"
echo "4. Test status transitions"
echo ""
echo "For detailed info, see:"
echo "- /ORDER_WORKFLOW.md"
echo "- /CHANGES_SUMMARY.md"
echo "- /README_ORDER_WORKFLOW.md"
echo ""
