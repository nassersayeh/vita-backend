// IMPLEMENTATION: Insurance Claim WhatsApp Notifications
// ========================================================

/**
 * FEATURE: Automatic WhatsApp notifications for insurance claims
 * 
 * CHANGES MADE:
 * 1. Import sendCustomMessage from whatsappService
 * 2. Send notification when claim is created (POST /:pharmacyId)
 * 3. Send status update notification when claim status changes (PUT /claim/:claimId/status)
 * 
 * ==================== CLAIM CREATION NOTIFICATION ====================
 * 
 * Triggered when: Pharmacy submits an insurance claim
 * Recipient: Pharmacy (via WhatsApp)
 * Content:
 *   - 📋 تنبيه: تم تقديم مطالبة مالية
 *   - اسم الصيدلية
 *   - اسم شركة التأمين
 *   - قيمة المطالبة
 *   - عدد المطالبات
 *   - رسالة تأكيد الاستقبال
 * 
 * Example Message:
 *   📋 *تنبيه: تم تقديم مطالبة مالية*
 *   
 *   الصيدلية: صيدلية العمراوي
 *   شركة التأمين: جلوب ميد فلسطين - GlobeMed Palestine
 *   القيمة: 5000 ₪
 *   عدد المطالبات: 25
 *   
 *   ✅ تم استقبال المطالبة بنجاح
 *   
 *   سيتم إشعاركم بتحديث حالة المطالبة عند معالجتها من قبل شركة التأمين.
 * 
 * ==================== STATUS UPDATE NOTIFICATION ====================
 * 
 * Triggered when: Insurance company updates claim status
 * Recipient: Pharmacy (via WhatsApp)
 * 
 * Status Messages:
 *   - ⏳ pending: تم استقبال المطالبة وجاري المراجعة
 *   - 👁️ under_review: المطالبة قيد المراجعة
 *   - ✅ approved: تم الموافقة على المطالبة
 *   - ⚠️ partially_approved: تم الموافقة الجزئية على المطالبة
 *   - 💰 paid: تم دفع المطالبة بمبلغ X ₪
 *   - ❌ rejected: تم رفض المطالبة + السبب
 * 
 * Example Messages:
 * 
 *   1. Pending:
 *      ⏳ *تحديث حالة المطالبة المالية*
 *      
 *      الصيدلية: صيدلية العمراوي
 *      شركة التأمين: جلوب ميد فلسطين - GlobeMed Palestine
 *      القيمة: 5000 ₪
 *      
 *      تم استقبال المطالبة وجاري المراجعة
 *   
 *   2. Paid:
 *      💰 *تحديث حالة المطالبة المالية*
 *      
 *      الصيدلية: صيدلية العمراوي
 *      شركة التأمين: جلوب ميد فلسطين - GlobeMed Palestine
 *      القيمة: 5000 ₪
 *      
 *      تم دفع المطالبة بمبلغ 4500 ₪
 * 
 * ==================== ERROR HANDLING ====================
 * 
 * - If WhatsApp fails to send, the request still succeeds (doesn't block)
 * - Errors are logged but don't fail the main operation
 * - Graceful fallback: notification is optional, claim operation is primary
 * 
 * ==================== IMPLEMENTATION DETAILS ====================
 * 
 * Routes Modified:
 *   1. POST /insurance-claims/:pharmacyId
 *      - Create claim
 *      - Get pharmacy info
 *      - Send WhatsApp to pharmacy
 * 
 *   2. PUT /insurance-claims/claim/:claimId/status
 *      - Update claim status
 *      - Populate pharmacy info
 *      - Send appropriate status notification
 * 
 * Dependencies:
 *   - sendCustomMessage: from services/whatsappService.js
 *   - Pharmacy mobileNumber field must exist
 *   - WhatsApp service must be initialized
 * 
 */

module.exports = {
  description: 'Insurance Claim WhatsApp Notifications Implementation'
};
