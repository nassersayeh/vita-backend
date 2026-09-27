const palestinianCountries = ['Palestine', 'palestine', 'فلسطين', 'PS', 'PSE'];
const isPalestinian = user => palestinianCountries.includes(String(user?.country || '').trim());
const canPractice = (user, access, role) => user?.role === role && user.activationStatus === 'active' && isPalestinian(user) && access?.unionApproved === true && access?.ministrySuspended !== true;
const serialFor = (allocationId, index) => `PS-CR-${String(allocationId).toUpperCase()}-${String(index + 1).padStart(4, '0')}`;
function validateControlledProducts(products) {
  if (!Array.isArray(products) || !products.length || products.length > 20) throw new Error('أضف من ١ إلى ٢٠ دواء.');
  const ids = new Set();
  for (const product of products) {
    if (!product || typeof product !== 'object' || Array.isArray(product)) throw new Error('بيانات الدواء غير صحيحة.');
    if (typeof product.drugId !== 'string' || !/^[a-f\d]{24}$/i.test(String(product.drugId)) || ids.has(String(product.drugId))) throw new Error('اختر أدوية مختلفة من قائمة الوزارة.');
    ids.add(String(product.drugId));
    for (const field of ['quantity', 'allowedPills']) {
      if (!['number', 'string'].includes(typeof product[field]) || !Number.isSafeInteger(Number(product[field])) || Number(product[field]) < 1 || Number(product[field]) > 100000) throw new Error('الكمية وعدد الحبات يجب أن يكونا أعداداً صحيحة موجبة.');
    }
    if (typeof product.dose !== 'string' || typeof product.frequency !== 'string' || (product.instructions !== undefined && typeof product.instructions !== 'string')) throw new Error('بيانات الجرعة غير صحيحة.');
    if (!String(product.dose || '').trim() || !String(product.frequency || '').trim()) throw new Error('الجرعة وتكرارها مطلوبان لكل دواء.');
  }
}
module.exports = { palestinianCountries, isPalestinian, canPractice, serialFor, validateControlledProducts };
