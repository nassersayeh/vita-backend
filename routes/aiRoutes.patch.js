// Patch file for assistantMessage

const createAnalyticalMessage = (language, patient, medicalRecords, prescriptions) => {
  const isArabic = language === 'ar';
  
  if (isArabic) {
    return `📋 **تقرير طبي شامل - المريض: ${patient?.fullName}**

---

## بيانات المريض الأساسية

المريض **${patient?.fullName}** يبلغ من العمر **${patient?.birthdate ? new Date().getFullYear() - new Date(patient.birthdate).getFullYear() : 'غير محدد'} سنة**، يسكن في **${patient?.city || 'غير محدد'}**.

- الهاتف: ${patient?.mobileNumber || 'غير محدد'}
- البريد الإلكتروني: ${patient?.email || 'غير محدد'}
- فصيلة الدم: ${patient?.bloodType || 'غير محدد'}

---

## التقارير الطبية (${medicalRecords?.length || 0} تقرير)

${medicalRecords?.map((r, idx) => {
      const dateStr = new Date(r.date).toLocaleDateString('ar-SA');
      return `
### ${idx + 1}. ${r.title}
- **التاريخ:** ${dateStr}
- **النتيجة:** ${r.diagnosis}
- **التوصيات:** ${r.recommendations || 'لا توجد توصيات محددة'}`;
    }).join('\n') || 'لا توجد تقارير طبية'}

---

## الروشيتات الدوائية (${prescriptions?.length || 0} روشيتة)

${prescriptions?.map((p, idx) => {
      const dateStr = new Date(p.date).toLocaleDateString('ar-SA');
      const expiryStr = p.expiryDate ? new Date(p.expiryDate).toLocaleDateString('ar-SA') : 'غير محدد';
      return `
### ${idx + 1}. ${p.medications || 'أدوية غير محددة'}
- **المؤشر الطبي:** ${p.diagnosis}
- **تاريخ الروشيتة:** ${dateStr}
- **انتهاء الصلاحية:** ${expiryStr}`;
    }).join('\n') || 'لا توجد روشيتات دوائية'}

---

## ملخص الحالة

✅ **عدد التقارير:** ${medicalRecords?.length || 0}
✅ **عدد الروشيتات:** ${prescriptions?.length || 0}
✅ **آخر تحديث:** ${medicalRecords?.[0]?.date ? new Date(medicalRecords[0].date).toLocaleDateString('ar-SA') : 'لا توجد بيانات'}`;
  } else {
    return `📋 **Comprehensive Medical Report - Patient: ${patient?.fullName}**

---

## Patient Basic Information

Patient **${patient?.fullName}** is **${patient?.birthdate ? new Date().getFullYear() - new Date(patient.birthdate).getFullYear() : 'Not specified'} years old**, residing in **${patient?.city || 'Not specified'}**.

- Contact: ${patient?.mobileNumber || 'Not specified'}
- Email: ${patient?.email || 'Not specified'}
- Blood Type: ${patient?.bloodType || 'Not specified'}

---

## Medical Reports (${medicalRecords?.length || 0} records)

${medicalRecords?.map((r, idx) => {
      const dateStr = new Date(r.date).toLocaleDateString('en-US');
      return `
### ${idx + 1}. ${r.title}
- **Date:** ${dateStr}
- **Finding:** ${r.diagnosis}
- **Recommendations:** ${r.recommendations || 'No specific recommendations'}`;
    }).join('\n') || 'No medical records found'}

---

## Active Prescriptions (${prescriptions?.length || 0} prescriptions)

${prescriptions?.map((p, idx) => {
      const dateStr = new Date(p.date).toLocaleDateString('en-US');
      const expiryStr = p.expiryDate ? new Date(p.expiryDate).toLocaleDateString('en-US') : 'Not specified';
      return `
### ${idx + 1}. ${p.medications || 'Unspecified medications'}
- **Indication:** ${p.diagnosis}
- **Date:** ${dateStr}
- **Expiry:** ${expiryStr}`;
    }).join('\n') || 'No prescriptions found'}

---

## Case Summary

✅ **Medical Records:** ${medicalRecords?.length || 0}
✅ **Active Prescriptions:** ${prescriptions?.length || 0}
✅ **Last Updated:** ${medicalRecords?.[0]?.date ? new Date(medicalRecords[0].date).toLocaleDateString('en-US') : 'No data'}`;
  }
};

module.exports = { createAnalyticalMessage };
