#!/bin/bash

# Test data creation script using API calls
# This script adds test data for doctor-patient testing

set -e

# APIs URLs
BASE_URL="http://localhost:3000"  # أو غيّرها إلى الـ URL الصحيح

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🔄 بدء إضافة بيانات الاختبار...${NC}\n"

# 1. البحث عن المريض
echo -e "${YELLOW}🔍 البحث عن المريض (nassersayeh)...${NC}"
PATIENT_RESPONSE=$(curl -s -X GET "$BASE_URL/api/users/search?query=nassersayeh" \
  -H "Content-Type: application/json")

PATIENT_ID=$(echo "$PATIENT_RESPONSE" | grep -o '"_id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$PATIENT_ID" ]; then
  echo -e "${RED}❌ لم يتم العثور على المريض${NC}"
  exit 1
fi

echo -e "${GREEN}✅ تم العثور على المريض: $PATIENT_ID${NC}\n"

# 2. البحث عن الدكتور
echo -e "${YELLOW}🔍 البحث عن الدكتور (0599123461)...${NC}"
DOCTOR_RESPONSE=$(curl -s -X GET "$BASE_URL/api/users/search?query=0599123461" \
  -H "Content-Type: application/json")

DOCTOR_ID=$(echo "$DOCTOR_RESPONSE" | grep -o '"_id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$DOCTOR_ID" ]; then
  echo -e "${RED}❌ لم يتم العثور على الدكتور${NC}"
  exit 1
fi

echo -e "${GREEN}✅ تم العثور على الدكتور: $DOCTOR_ID${NC}\n"

# 3. إضافة المريض إلى قائمة مرضى الدكتور
echo -e "${YELLOW}➕ إضافة المريض إلى قائمة الدكتور...${NC}"

curl -s -X PUT "$BASE_URL/api/doctors/$DOCTOR_ID/add-patient" \
  -H "Content-Type: application/json" \
  -d "{\"patientId\": \"$PATIENT_ID\"}" > /dev/null

echo -e "${GREEN}✅ تم إضافة المريض${NC}\n"

echo -e "${GREEN}✅ اكتمل إضافة البيانات!${NC}"
echo -e "المريض: $PATIENT_ID"
echo -e "الدكتور: $DOCTOR_ID"
