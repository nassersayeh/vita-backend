const formatWhatsAppDisplayName = (fullName = '', role = 'User', language = 'ar') => {
  const name = String(fullName || '').trim();
  if (!name) return '';

  const roleTitles = language === 'ar'
    ? {
      Doctor: 'د.',
      Pharmacy: 'صيدلية',
      Lab: 'مختبر',
      Clinic: 'عيادة',
      Hospital: 'مستشفى',
      Institution: 'مركز',
    }
    : {
      Doctor: 'Dr.',
      Pharmacy: 'Pharmacy',
      Lab: 'Lab',
      Clinic: 'Clinic',
      Hospital: 'Hospital',
      Institution: 'Medical Center',
    };

  const title = roleTitles[role];
  return title ? `${title} ${name}` : name;
};

const SUBSCRIPTION_PLANS = {
  core: { name: 'Core System', monthlyPrice: 100, yearlyPrice: 1000, trialDays: 7 },
  growth: { name: 'Growth + AI', monthlyPrice: 500, yearlyPrice: 5000, trialDays: 0 },
  premium: { name: 'Premium Media Growth', monthlyPrice: 1500, yearlyPrice: 15000, trialDays: 0 },
};

const getPlanPrice = (planKey, billingCycle) => {
  const plan = SUBSCRIPTION_PLANS[planKey];
  if (!plan) return null;
  return billingCycle === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice;
};

const applyPaidSubscription = (user, {
  planKey = user.subscriptionPlanKey,
  billingCycle = user.subscriptionBillingCycle,
  paymentMethod = user.paymentMethod,
  amount = null,
} = {}) => {
  const plan = SUBSCRIPTION_PLANS[planKey];
  const normalizedCycle = billingCycle === 'yearly' ? 'yearly' : 'monthly';
  const subscriptionStart = new Date();
  const subscriptionEnd = new Date(subscriptionStart);

  if (normalizedCycle === 'yearly') {
    subscriptionEnd.setFullYear(subscriptionEnd.getFullYear() + 1);
  } else {
    subscriptionEnd.setMonth(subscriptionEnd.getMonth() + 1);
  }

  user.subscriptionPlanKey = planKey;
  user.subscriptionPlanName = plan?.name || user.subscriptionPlanName;
  user.subscriptionMonthlyPrice = plan?.monthlyPrice ?? user.subscriptionMonthlyPrice;
  user.subscriptionYearlyPrice = plan?.yearlyPrice ?? user.subscriptionYearlyPrice;
  user.subscriptionBillingCycle = normalizedCycle;
  user.subscriptionSelectedPrice = amount ?? getPlanPrice(planKey, normalizedCycle);
  user.subscriptionType = planKey;
  user.paymentMethod = paymentMethod || user.paymentMethod;
  user.paymentMethodSelectedAt = paymentMethod ? new Date() : user.paymentMethodSelectedAt;
  user.isPaid = true;
  user.subscriptionStatus = 'active';
  user.subscriptionStartDate = subscriptionStart;
  user.subscriptionEndDate = subscriptionEnd;
  user.subscriptionPlanUnit = normalizedCycle === 'yearly' ? 'year' : 'month';
  user.subscriptionPlanValue = 1;
  user.lastPaymentAmount = user.subscriptionSelectedPrice;
  user.lastPaymentAt = subscriptionStart;
  user.trialStartDate = null;
  user.trialEndDate = null;
  user.trialUsed = false;
};

const getWhatsAppPhoneCandidates = (user) => {
  const userPhone = user.mobileNumber || user.phone;
  if (!userPhone) return [];

  const normalizedCountry = String(user.country || '').trim().toLowerCase();
  const countryCodes = normalizedCountry.includes('الأردن') || normalizedCountry.includes('اردن') || normalizedCountry.includes('jordan')
    ? ['962']
    : normalizedCountry.includes('قطر') || normalizedCountry.includes('qatar')
      ? ['974']
      : normalizedCountry.includes('السعود') || normalizedCountry.includes('saudi')
        ? ['966']
        : ['970', '972'];

  let localPhone = String(userPhone).replace(/\D/g, '');
  if (localPhone.startsWith('00')) localPhone = localPhone.slice(2);
  const matchingCode = countryCodes.find((code) => localPhone.startsWith(code));
  if (matchingCode) localPhone = localPhone.slice(matchingCode.length);
  localPhone = localPhone.replace(/^0+/, '');

  if (!localPhone) return [];
  return Array.from(new Set(countryCodes.map((code) => `${code}${localPhone}`)));
};

const sendSubscriptionActivationWhatsApp = async (user) => {
  try {
    const { sendWhatsAppMessage, isWhatsAppReady } = require('../services/whatsappService');
    const ready = await isWhatsAppReady();
    const phoneCandidates = getWhatsAppPhoneCandidates(user);
    console.log(`[SubscriptionApproval] WhatsApp ready: ${ready}, candidates: ${phoneCandidates.length}, userId: ${user._id}`);
    if (!ready || !phoneCandidates.length) return;

    const displayNameAr = formatWhatsAppDisplayName(user.fullName, user.role, 'ar');
    const displayNameEn = formatWhatsAppDisplayName(user.fullName, user.role, 'en');
    const planName = user.subscriptionPlanName || user.subscriptionPlanKey || 'Vita';
    const endDate = user.subscriptionEndDate ? new Date(user.subscriptionEndDate).toLocaleDateString('en-GB') : '';
    const billingCycleAr = user.subscriptionBillingCycle === 'yearly' ? 'سنوي' : 'شهري';
    const billingCycleEn = user.subscriptionBillingCycle === 'yearly' ? 'yearly' : 'monthly';

    const message = `مرحباً ${displayNameAr}\nتم تفعيل خدمة فيتا بنجاح ✅\n\nالخطة: ${planName}\nالفوترة: ${billingCycleAr}${endDate ? `\nصالحة حتى: ${endDate}` : ''}\n\nيمكنك الآن الدخول إلى حسابك واستخدام لوحة التحكم.\nرابط تسجيل الدخول: https://www.vita.ps/login\n\nللدعم والمساعدة تواصل معنا: 0568899090\n---\nHello ${displayNameEn},\nYour Vita service has been activated successfully ✅\n\nPlan: ${planName}\nBilling: ${billingCycleEn}${endDate ? `\nValid until: ${endDate}` : ''}\n\nYou can now log in and use your dashboard.\nLogin link: https://www.vita.ps/login\n\nFor support contact us: 0568899090`;

    await Promise.all(phoneCandidates.map((phoneNumber) => sendWhatsAppMessage(phoneNumber, message).catch((err) => {
      console.error(`Failed to send subscription activation WhatsApp to ${phoneNumber}:`, err.message);
    })));
  } catch (err) {
    console.error('Subscription activation WhatsApp error:', err.message);
  }
};

// Get user counts by role
exports.getUserStats = async (req, res) => {
  try {
    const usersByRole = await User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]);
    res.json(usersByRole.reduce((acc, curr) => ({ ...acc, [curr._id]: curr.count }), {}));
  } catch (error) {
    res.status(500).json({ message: 'Server error while fetching user stats' });
  }
};

// List users with trial status (active, ended, paid/unpaid)
exports.getTrialUsers = async (req, res) => {
  try {
    const users = await User.find({ role: { $in: ['Doctor', 'Pharmacy', 'Lab', 'Institution', 'Hospital'] } })
      .select('fullName role isPaid trialEndDate createdAt email activationStatus');
    const now = new Date();
    const result = users.map(u => {
      let trialEnded = false;
      if (u.trialEndDate && now > u.trialEndDate) trialEnded = true;
      return {
        id: u._id,
        fullName: u.fullName,
        role: u.role,
        isPaid: u.isPaid,
        trialEndDate: u.trialEndDate,
        createdAt: u.createdAt,
        email: u.email,
        activationStatus: u.activationStatus,
        trialEnded
      };
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Server error while fetching trial users' });
  }
};

// Extend trial for a user
exports.extendTrial = async (req, res) => {
  try {
    const { id } = req.params;
    const { days, months } = req.body;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    // If trial has already ended, extend from now; otherwise extend from current trial end
    const now = new Date();
    let endDate = user.trialEndDate && new Date(user.trialEndDate) > now ? new Date(user.trialEndDate) : new Date();
    if (months) endDate.setMonth(endDate.getMonth() + Number(months));
    if (days) endDate.setDate(endDate.getDate() + Number(days));
    user.trialEndDate = endDate;
    await user.save();
    console.log(`Admin extended trial for user ${user._id}. New trialEndDate: ${user.trialEndDate}`);
    // Notify user
    try {
      const Notification = require('../models/Notification');
      const unitStr = months ? `${months} month${months > 1 ? 's' : ''}` : `${days} day${days > 1 ? 's' : ''}`;
      await Notification.create({
        user: user._id,
        type: 'subscription',
        message: `Your trial was extended by ${unitStr}. New end date: ${new Date(user.trialEndDate).toLocaleDateString()}.`,
      });
    } catch (e) {
      console.error('Failed to create trial extension notification:', e.message);
    }
    res.json({ message: 'Trial extended', trialEndDate: user.trialEndDate, trialActive: new Date(user.trialEndDate) > new Date() });
  } catch (error) {
    res.status(500).json({ message: 'Server error while extending trial' });
  }
};

// Update payment status for a user
exports.updatePaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isPaid, amount, durationUnit, durationValue } = req.body;
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.isPaid = !!isPaid;

    // When marking as paid, set subscription details
    if (user.isPaid) {
      const now = new Date();
      let end = new Date(now);
      if (durationUnit && durationValue) {
        if (durationUnit === 'year') {
          end.setFullYear(end.getFullYear() + Number(durationValue));
        } else {
          end.setMonth(end.getMonth() + Number(durationValue));
        }
        user.subscriptionPlanUnit = durationUnit;
        user.subscriptionPlanValue = Number(durationValue);
      } else {
        // default to 1 month if not specified
        end.setMonth(end.getMonth() + 1);
        user.subscriptionPlanUnit = 'month';
        user.subscriptionPlanValue = 1;
      }
      user.subscriptionEndDate = end;
      if (amount != null) user.lastPaymentAmount = Number(amount);
      user.lastPaymentAt = now;
      // also align trialEndDate to subscription end for compatibility consumers
      user.trialEndDate = end;
    } else {
      // If marking as unpaid, clear subscription metadata
      user.subscriptionPlanUnit = null;
      user.subscriptionPlanValue = null;
      user.lastPaymentAmount = null;
      user.lastPaymentAt = null;
      user.subscriptionEndDate = null;
    }

    await user.save();

    // Create a user notification about the change
    try {
      const Notification = require('../models/Notification');
      if (user.isPaid) {
        const amountText = amount != null ? `$${Number(amount).toFixed(2)}` : 'your subscription';
        const planText = `${user.subscriptionPlanValue} ${user.subscriptionPlanUnit}${user.subscriptionPlanValue > 1 ? 's' : ''}`;
        const endText = user.subscriptionEndDate ? new Date(user.subscriptionEndDate).toLocaleDateString() : '';
        await Notification.create({
          user: user._id,
          type: 'payment',
          message: `Subscription activated: ${amountText} for ${planText}. Valid until ${endText}.`,
        });
      } else {
        await Notification.create({
          user: user._id,
          type: 'subscription',
          message: 'Your subscription has been marked as unpaid by admin.',
        });
      }
    } catch (e) {
      console.error('Failed to create payment notification:', e.message);
    }

    if (user.isPaid) {
      await sendSubscriptionActivationWhatsApp(user);
    }

    res.json({ 
      message: 'Payment status updated', 
      isPaid: user.isPaid,
      subscriptionEndDate: user.subscriptionEndDate,
      subscriptionPlanUnit: user.subscriptionPlanUnit,
      subscriptionPlanValue: user.subscriptionPlanValue,
      lastPaymentAmount: user.lastPaymentAmount,
      lastPaymentAt: user.lastPaymentAt
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error while updating payment status' });
  }
};
const User = require('../models/User');
const AdminNotification = require('../models/AdminNotification');
const Points = require('../models/Points');
const Order = require('../models/Order');
const Appointment = require('../models/Appointment');
const Financial = require('../models/Financial');
const PotentialClientStatus = require('../models/PotentialClientStatus');
const PointSettings = require('../models/PointSettings');
const LandingAnalyticsEvent = require('../models/LandingAnalyticsEvent');
const DemoRequest = require('../models/DemoRequest');
const { assignDefaultInventory } = require('../utils/assignDefaultInventory');
const axios = require('axios');
const crypto = require('crypto');

const leadStatusValues = ['none', 'contacted', 'subscribed', 'trial', 'rejected'];
const demoRequestStatusValues = ['new', 'contacted', 'scheduled', 'closed'];
const potentialClientsCache = {
  data: null,
  fetchedAt: 0,
};
const POTENTIAL_CLIENTS_CACHE_MS = 60 * 60 * 1000;
const SMARTHEALTH_MAX_PAGES = Number(process.env.SMARTHEALTH_LEADS_MAX_PAGES || 80);

const decodeHtml = (value = '') => String(value)
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));

const stripTags = (value = '') => decodeHtml(String(value).replace(/<[^>]*>/g, ' '))
  .replace(/\s+/g, ' ')
  .trim();

const makeLeadKey = (source, parts) => crypto
  .createHash('sha1')
  .update(`${source}:${parts.filter(Boolean).join('|')}`)
  .digest('hex');

const extractCityFromAddress = (address = '') => {
  const firstPart = String(address).split(/[-–،,]/)[0]?.trim();
  return firstPart || '';
};

const extractRows = (html = '') => {
  const rows = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(html))) {
    const cells = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      cells.push(stripTags(cellMatch[1]));
    }

    if (cells.length) rows.push(cells);
  }

  return rows;
};

const fetchSmartHealthPage = async (page) => {
  const url = `https://smarthealth.ps/ar/medicals?commit=%D8%A5%D8%A8%D8%AD%D8%AB&page=${page}&q%5Bcity_id_eq%5D=&q%5Bmedical_category_id_eq%5D=&q%5Bname_cont%5D=`;
  const { data } = await axios.get(url, {
    timeout: 12000,
    headers: { 'User-Agent': 'Mozilla/5.0 Vita Admin Leads' },
  });

  return extractRows(data)
    .filter((cells) => cells.length >= 4 && !cells[0].includes('اسم المركز'))
    .map((cells) => {
      const [name, address, phone, specialty] = cells;
      const sourceKey = makeLeadKey('smarthealth', [name, address, phone, specialty]);

      return {
        source: 'smarthealth',
        sourceLabel: 'الأطباء',
        sourceKey,
        name,
        phone,
        address,
        specialty,
        city: extractCityFromAddress(address),
        status: 'none',
      };
    })
    .filter((lead) => lead.name && lead.address);
};

const fetchSmartHealthLeads = async () => {
  const pageNumbers = Array.from({ length: SMARTHEALTH_MAX_PAGES }, (_, index) => index + 1);
  const leads = [];

  for (let index = 0; index < pageNumbers.length; index += 8) {
    const batch = pageNumbers.slice(index, index + 8);
    const results = await Promise.allSettled(batch.map(fetchSmartHealthPage));
    results.forEach((result) => {
      if (result.status === 'fulfilled') leads.push(...result.value);
    });
  }

  return leads;
};

const fetchPharmacyLeads = async () => {
  const { data } = await axios.get('https://ppa.ps/PPAMS/Reports/PharmacyListReportPublic.php', {
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0 Vita Admin Leads' },
  });

  return extractRows(data)
    .filter((cells) => cells.length >= 6 && !cells[0].includes('المحافظة'))
    .map((cells) => {
      const [city, mobile, pharmacyPhone, address, pharmacyName, pharmacistName] = cells;
      const phone = [mobile, pharmacyPhone].filter(Boolean).join(' / ');
      const sourceKey = makeLeadKey('ppa', [city, phone, address, pharmacyName, pharmacistName]);

      return {
        source: 'ppa',
        sourceLabel: 'الصيدليات',
        sourceKey,
        name: pharmacyName || pharmacistName,
        phone,
        address,
        specialty: 'صيدلية',
        city,
        status: 'none',
      };
    })
    .filter((lead) => lead.name);
};

const getPotentialClientsData = async (forceRefresh = false) => {
  const now = Date.now();
  if (!forceRefresh && potentialClientsCache.data && now - potentialClientsCache.fetchedAt < POTENTIAL_CLIENTS_CACHE_MS) {
    return potentialClientsCache.data;
  }

  const results = await Promise.allSettled([
    fetchSmartHealthLeads(),
    fetchPharmacyLeads(),
  ]);

  const leads = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
  const unique = Array.from(
    new Map(leads.map((lead) => [`${lead.source}:${lead.sourceKey}`, lead])).values()
  );

  potentialClientsCache.data = unique;
  potentialClientsCache.fetchedAt = now;
  return unique;
};

// Get pending provider approvals
exports.getPendingApprovals = async (req, res) => {
  try {
    const pendingRegistrationUsers = await User.find({
      activationStatus: 'pending',
      role: { $in: ['Doctor', 'Pharmacy', 'Lab', 'Institution', 'Hospital'] }
    }).select('-password').sort({ createdAt: -1 });

    const pendingPlanRequests = await User.find({
      role: { $in: ['Doctor', 'Pharmacy', 'Lab', 'Institution', 'Hospital'] },
      activationStatus: 'active',
      'planChangeRequest.status': 'pending',
    }).select('-password').sort({ 'planChangeRequest.requestedAt': -1 });

    const registrationRequests = pendingRegistrationUsers.map((user) => ({
      ...user.toObject(),
      approvalRequestType: 'registration',
    }));

    const planRequests = pendingPlanRequests.map((user) => ({
      ...user.toObject(),
      approvalRequestType: 'plan_change',
      requestedAt: user.planChangeRequest?.requestedAt || user.updatedAt,
    }));

    res.json([...planRequests, ...registrationRequests]);
  } catch (error) {
    console.error('Get pending approvals error:', error);
    res.status(500).json({ message: 'Server error while fetching pending approvals' });
  }
};

// Approve or reject user
exports.approveUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, adminId, rejectionReason, requestType } = req.body;

    if (!['active', 'declined'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const isPlanChangeRequest = requestType === 'plan_change' || (
      user.activationStatus === 'active' && user.planChangeRequest?.status === 'pending'
    );

    if (isPlanChangeRequest) {
      if (!user.planChangeRequest || user.planChangeRequest.status !== 'pending') {
        return res.status(400).json({ message: 'No pending plan change request found.' });
      }

      if (status === 'active') {
        applyPaidSubscription(user, {
          planKey: user.planChangeRequest.requestedPlanKey,
          billingCycle: user.planChangeRequest.requestedBillingCycle,
          paymentMethod: user.planChangeRequest.paymentMethod,
          amount: user.planChangeRequest.requestedPrice,
        });
        user.planChangeRequest.status = 'approved';
      } else {
        user.planChangeRequest.status = 'declined';
        if (rejectionReason) user.rejectionReason = rejectionReason;
      }

      user.approvedBy = adminId;
      user.approvedAt = new Date();
      await user.save({ validateBeforeSave: false });

      try {
        const Notification = require('../models/Notification');
        await Notification.create({
          user: user._id,
          type: 'subscription',
          message: status === 'active'
            ? `Your subscription renewal request was approved. Your ${user.subscriptionPlanName || 'selected plan'} is now active until ${user.subscriptionEndDate ? new Date(user.subscriptionEndDate).toLocaleDateString() : 'the subscription end date'}.`
            : `Your subscription renewal request was declined${rejectionReason ? `: ${rejectionReason}` : '.'}`,
        });
      } catch (e) {
        console.error('Failed to create plan request notification:', e.message);
      }

      if (status === 'active') {
        await sendSubscriptionActivationWhatsApp(user);
      }

      return res.json({
        message: status === 'active' ? 'Plan change request approved successfully' : 'Plan change request declined',
        user,
      });
    }

    user.activationStatus = status;
    user.approvedBy = adminId;
    user.approvedAt = new Date();

    // When approving a professional user, preserve the selected registration plan.
    // Core starts with a 7-day free trial; higher plans start a monthly cycle.
    if (status === 'active' && user.role !== 'User') {
      if (user.subscriptionPlanKey) {
        user.subscriptionType = user.subscriptionPlanKey;
        if (user.subscriptionPlanKey === 'core') {
          const trialStart = new Date();
          user.isPaid = false;
          user.subscriptionStatus = 'trial';
          user.trialStartDate = trialStart;
          user.trialEndDate = new Date(trialStart.getTime() + 7 * 24 * 60 * 60 * 1000);
          user.subscriptionStartDate = null;
          user.subscriptionEndDate = null;
          user.trialUsed = true;
        } else {
          const subscriptionStart = new Date();
          const subscriptionEnd = new Date(subscriptionStart);
          const billingCycle = user.subscriptionBillingCycle === 'yearly' ? 'yearly' : 'monthly';
          if (billingCycle === 'yearly') {
            subscriptionEnd.setFullYear(subscriptionEnd.getFullYear() + 1);
          } else {
            subscriptionEnd.setMonth(subscriptionEnd.getMonth() + 1);
          }
          user.isPaid = true;
          user.subscriptionStatus = 'active';
          user.subscriptionStartDate = subscriptionStart;
          user.subscriptionEndDate = subscriptionEnd;
          user.subscriptionPlanUnit = billingCycle === 'yearly' ? 'year' : 'month';
          user.subscriptionPlanValue = 1;
          user.trialEndDate = null;
          user.trialStartDate = null;
          user.trialUsed = false;
        }
      } else {
        user.isPaid = false;
        user.subscriptionType = 'free';
        user.subscriptionStatus = 'inactive';
        user.trialEndDate = null;
        user.trialStartDate = null;
        user.subscriptionStartDate = null;
        user.subscriptionEndDate = null;
        user.trialUsed = false;
      }
    }

    if (status === 'declined' && rejectionReason) {
      user.rejectionReason = rejectionReason;
    }

    await user.save({ validateBeforeSave: false });

    // Auto-assign default drug inventory when a Pharmacy is approved
    if (status === 'active' && user.role === 'Pharmacy') {
      try {
        const invCount = await assignDefaultInventory(user._id);
        console.log(`Auto-assigned ${invCount} inventory items to pharmacy ${user._id} (${user.fullName})`);
      } catch (invErr) {
        console.error('Failed to auto-assign inventory:', invErr.message);
        // Don't fail the approval - inventory can be assigned later
      }
    }

    // Send WhatsApp notification to user about approval/rejection
    try {
      const { sendWhatsAppMessage, isWhatsAppReady } = require('../services/whatsappService');
      const ready = await isWhatsAppReady();
      const userPhone = user.mobileNumber || user.phone;
      console.log(`[ApproveUser] WhatsApp ready: ${ready}, userPhone: ${userPhone}, status: ${status}`);
      if (ready && userPhone) {
        let msg = '';
        const normalizedCountry = String(user.country || '').trim().toLowerCase();
        const countryCodes = normalizedCountry.includes('الأردن') || normalizedCountry.includes('اردن') || normalizedCountry.includes('jordan')
          ? ['962']
          : normalizedCountry.includes('قطر') || normalizedCountry.includes('qatar')
            ? ['974']
            : normalizedCountry.includes('السعود') || normalizedCountry.includes('saudi')
              ? ['966']
              : ['970', '972'];
        let localPhone = userPhone.replace(/\D/g, '');
        if (localPhone.startsWith('00')) localPhone = localPhone.slice(2);
        const matchingCode = countryCodes.find((code) => localPhone.startsWith(code));
        if (matchingCode) localPhone = localPhone.slice(matchingCode.length);
        localPhone = localPhone.replace(/^0+/, '');
        const phoneCandidates = Array.from(new Set(countryCodes.map((code) => `${code}${localPhone}`)));
        const loginPhone = `+${phoneCandidates[0]}`;
        const displayNameAr = formatWhatsAppDisplayName(user.fullName, user.role, 'ar');
        const displayNameEn = formatWhatsAppDisplayName(user.fullName, user.role, 'en');
        if (status === 'active') {
          msg = `مبروك ${displayNameAr} 🎉\nتم تفعيل حسابك في نظام فيتا الصحي بنجاح!\n\nاستمتع بـ 7 أيام تجريبية، وسنتواصل معك قريباً لمساعدتك في تفعيل حسابك والاستفادة من خدمات النظام.\n\nبيانات تسجيل الدخول:\nاسم المستخدم: ${loginPhone}\nكلمة المرور: كلمة المرور التي قمت بإدخالها أو جرّب 123456789\nرابط تسجيل الدخول: https://www.vita.ps/login\n\nيمكنك الآن تسجيل الدخول والاستمتاع بجميع خدمات النظام.\nللدعم والمساعدة تواصل معنا: 0568899090\n---\nCongratulations ${displayNameEn} 🎉\nYour account on Vita Health System has been approved!\n\nEnjoy a 7-day free trial. We will contact you soon to help you activate your account and get the most from the system.\n\nLogin details:\nUsername: ${loginPhone}\nPassword: the password you entered during registration, or try 123456789\nLogin link: https://www.vita.ps/login\n\nYou can now log in and enjoy all system services.\nFor support contact us: 0568899090`;
        } else {
          msg = `عزيزي ${displayNameAr},\nنأسف لإعلامك أن طلب تسجيلك في نظام فيتا الصحي قد تم رفضه.\n${rejectionReason ? `السبب: ${rejectionReason}\n` : ''}للاستفسار تواصل معنا: 0599909926\n---\nDear ${displayNameEn},\nWe regret to inform you that your registration request on Vita Health System has been declined.\n${rejectionReason ? `Reason: ${rejectionReason}\n` : ''}For inquiries contact us: 0599909926`;
        }
        await Promise.all(phoneCandidates.map((phoneNumber) => sendWhatsAppMessage(phoneNumber, msg).catch(() => {})));
      }
    } catch (waErr) {
      console.error('WhatsApp approval notification error:', waErr.message);
    }

    res.json({
      message: `User ${status === 'active' ? 'approved' : 'rejected'} successfully`,
      user: {
        id: user._id,
        fullName: user.fullName,
        role: user.role,
        activationStatus: user.activationStatus,
        subscriptionType: user.subscriptionType,
        subscriptionStatus: user.subscriptionStatus,
        subscriptionPlanKey: user.subscriptionPlanKey,
        subscriptionPlanName: user.subscriptionPlanName,
        subscriptionBillingCycle: user.subscriptionBillingCycle,
        subscriptionSelectedPrice: user.subscriptionSelectedPrice,
        paymentMethod: user.paymentMethod,
        subscriptionStartDate: user.subscriptionStartDate,
        subscriptionEndDate: user.subscriptionEndDate,
        trialEndDate: user.trialEndDate,
        isPaid: user.isPaid
      }
    });
  } catch (error) {
    console.error('Approve user error:', error);
    res.status(500).json({ message: 'Server error while approving user' });
  }
};

// Get all users with filtering
exports.getAllUsers = async (req, res) => {
  try {
    const { role, status, page = 1, limit = 20, search } = req.query;
    
    let filter = {};
    if (role) filter.role = role;
    if (status) filter.activationStatus = status;
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { idNumber: { $regex: search, $options: 'i' } }
      ];
    }

    // Support fetching all users without pagination when limit === 'all'
    let users;
    let total;
    if (String(limit).toLowerCase() === 'all') {
      users = await User.find(filter)
        .select('-password')
        .sort({ createdAt: -1 });
      total = users.length;
      res.json({
        users,
        totalPages: 1,
        currentPage: 1,
        total
      });
    } else {
      users = await User.find(filter)
        .select('-password')
        .sort({ createdAt: -1 })
        .limit(Number(limit) * 1)
        .skip((Number(page) - 1) * Number(limit));

      total = await User.countDocuments(filter);

      res.json({
        users,
        totalPages: Math.ceil(total / Number(limit)),
        currentPage: Number(page),
        total
      });
    }
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({ message: 'Server error while fetching users' });
  }
};

// Send targeted notification
exports.sendNotification = async (req, res) => {
  try {
    const { title, content, targetGroup, targetUsers, adminId } = req.body;

    if (!title || !content || !targetGroup) {
      return res.status(400).json({ message: 'Title, content, and target group are required' });
    }

    const notification = new AdminNotification({
      title,
      content,
      targetGroup,
      targetUsers: targetUsers || [],
      sentBy: adminId
    });

    await notification.save();

    let recipientCount = 0;
    if (targetGroup === 'all') {
      recipientCount = await User.countDocuments({ activationStatus: 'active' });
    } else if (targetUsers && targetUsers.length > 0) {
      recipientCount = targetUsers.length;
    } else {
      const roleMap = {
        'patients': 'User',
        'doctors': 'Doctor',
        'pharmacies': 'Pharmacy',
        'labs': 'Lab'
      };
      recipientCount = await User.countDocuments({ 
        role: roleMap[targetGroup], 
        activationStatus: 'active' 
      });
    }

    notification.deliveryStats.totalSent = recipientCount;
    await notification.save();

    res.json({
      message: 'Notification sent successfully',
      notificationId: notification._id,
      recipientCount
    });
  } catch (error) {
    console.error('Send notification error:', error);
    res.status(500).json({ message: 'Server error while sending notification' });
  }
};

// Get dashboard analytics
exports.getDashboardAnalytics = async (req, res) => {
  try {
    const { period = '30' } = req.query; // days
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(period));

    // User statistics
    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ activationStatus: 'active' });
    const pendingUsers = await User.countDocuments({ activationStatus: 'pending' });
    
    const usersByRole = await User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]);

    // Recent registrations by role
    const recentRegistrations = await User.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      { $group: { _id: '$role', count: { $sum: 1 } } }
    ]);

    // Appointment statistics
    const totalAppointments = await Appointment.countDocuments();
    const recentAppointments = await Appointment.countDocuments({
      createdAt: { $gte: startDate }
    });

    // Order statistics
    const totalOrders = await Order.countDocuments();
    const recentOrders = await Order.countDocuments({
      createdAt: { $gte: startDate }
    });

    // Revenue from orders
    const orderRevenue = await Order.aggregate([
      { $match: { createdAt: { $gte: startDate }, status: { $ne: 'cancelled' } } },
      { $group: { _id: null, totalRevenue: { $sum: '$total' } } }
    ]);

    // Revenue from provider subscriptions (paid users)
    const subscriptionRevenue = await User.aggregate([
      { 
        $match: { 
          isPaid: true, 
          lastPaymentAt: { $gte: startDate },
          lastPaymentAmount: { $exists: true, $ne: null }
        } 
      },
      { $group: { _id: null, totalRevenue: { $sum: '$lastPaymentAmount' } } }
    ]);

    // Total revenue = orders + subscriptions
    const totalRevenue = (orderRevenue[0]?.totalRevenue || 0) + (subscriptionRevenue[0]?.totalRevenue || 0);

    // Points statistics
    const totalPointsAwarded = await Points.aggregate([
      { $group: { _id: null, total: { $sum: '$totalPoints' } } }
    ]);

    // Financial overview
    const financialOverview = await Financial.aggregate([
      { $match: { createdAt: { $gte: startDate } } },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$totalEarnings' },
          totalExpenses: { $sum: '$totalExpenses' }
        }
      }
    ]);

    res.json({
      users: {
        total: totalUsers,
        active: activeUsers,
        pending: pendingUsers,
        byRole: usersByRole.reduce((acc, curr) => ({ ...acc, [curr._id]: curr.count }), {}),
        recentRegistrations: recentRegistrations.reduce((acc, curr) => ({ ...acc, [curr._id]: curr.count }), {})
      },
      appointments: {
        total: totalAppointments,
        recent: recentAppointments
      },
      orders: {
        total: totalOrders,
        recent: recentOrders,
        revenue: totalRevenue,
        orderRevenue: orderRevenue[0]?.totalRevenue || 0,
        subscriptionRevenue: subscriptionRevenue[0]?.totalRevenue || 0
      },
      points: {
        totalAwarded: totalPointsAwarded[0]?.total || 0
      },
      financial: financialOverview[0] || { totalEarnings: 0, totalExpenses: 0 }
    });
  } catch (error) {
    console.error('Get dashboard analytics error:', error);
    res.status(500).json({ message: 'Server error while fetching analytics' });
  }
};

// Get notification history
exports.getNotificationHistory = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const notifications = await AdminNotification.find()
      .populate('sentBy', 'fullName')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await AdminNotification.countDocuments();

    res.json({
      notifications,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
      autograph
    });
  } catch (error) {
    console.error('Get notification history error:', error);
    res.status(500).json({ message: 'Server error while fetching notification history' });
  }
};

// Delete user (admin only)
exports.deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const { adminId } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role === 'Admin') {
      return res.status(403).json({ message: 'Cannot delete admin users' });
    }

    await User.findByIdAndDelete(userId);

    await Points.deleteOne({ userId });

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Server error while deleting user' });
  }
};

// Create a new user (admin only)
exports.createUser = async (req, res) => {
  try {
    const userData = req.body;
    const bcrypt = require('bcryptjs');
    
    const existingUser = await User.findOne({ 
      $or: [{ email: userData.email }, { mobileNumber: userData.mobileNumber }, { idNumber: userData.idNumber }] 
    });
    
    if (existingUser) {
      return res.status(400).json({ message: 'User with this email, mobile number, or ID already exists' });
    }

    // Hash password before saving
    if (userData.password) {
      const salt = await bcrypt.genSalt(10);
      userData.password = await bcrypt.hash(userData.password, salt);
    }

    const newUser = new User(userData);
    await newUser.save();

    // Auto-assign default drug inventory when creating a Pharmacy user
    if (newUser.role === 'Pharmacy') {
      try {
        const invCount = await assignDefaultInventory(newUser._id);
        console.log(`Auto-assigned ${invCount} inventory items to new pharmacy ${newUser._id}`);
      } catch (invErr) {
        console.error('Failed to auto-assign inventory on create:', invErr.message);
      }
    }

    res.status(201).json({ message: 'User created successfully', user: { id: newUser._id, fullName: newUser.fullName, role: newUser.role } });
  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ message: 'Server error while creating user' });
  }
};

// Get user by ID
exports.getUserById = async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({ message: 'Server error while fetching user' });
  }
};

// Update user data
exports.updateUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const updateData = req.body;
    const bcrypt = require('bcryptjs');
    
    // Handle password: hash if provided, otherwise remove from update
    if (updateData.password && updateData.password.trim()) {
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(updateData.password.trim(), salt);
    } else {
      delete updateData.password;
    }
    
    // Remove fields that don't exist on the User model to avoid errors
    const allowedFields = [
      'fullName', 'username', 'password', 'email', 'role', 'profileImage',
      'mobileNumber', 'country', 'city', 'idNumber', 'address', 'sex',
      'bloodType', 'height', 'weight', 'maritalStatus',
      'allergies', 'chronicConditions', 'medications', 'pastIllnesses',
      'emergencyContact', 'emergencyContactName', 'emergencyContactRelation', 'emergencyPhone',
      'insuranceProvider', 'insuranceNumber',
      'bio', 'specialty', 'licenseNumber', 'yearsOfExperience', 'consultationFee',
      'birthdate', 'gender', 'language',
      'activationStatus', 'isPaid', 'trialEndDate',
      // Professional-specific fields
      'pharmacyName', 'labName', 'hospitalName', 'institutionName',
      'institutionType', 'clinicAddress',
    ];
    
    const cleanData = {};
    for (const key of allowedFields) {
      if (key in updateData && updateData[key] !== undefined) {
        // Skip empty strings for numeric fields
        if (updateData[key] === '' && ['yearsOfExperience', 'consultationFee', 'height', 'weight'].includes(key)) {
          continue;
        }
        // Skip empty strings for email, idNumber, username - don't set them to null to avoid duplicate key errors
        if (updateData[key] === '' && ['email', 'idNumber', 'username'].includes(key)) {
          continue;
        }
        cleanData[key] = updateData[key];
      }
    }
    
    // Don't allow changing role or username via update
    delete cleanData.role;
    delete cleanData.username;
    
    const user = await User.findByIdAndUpdate(userId, { $set: cleanData }, { new: true }).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'User updated successfully', user });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ message: 'Server error while updating user' });
  }
};

// Get revenue by specific month
exports.getRevenueByMonth = async (req, res) => {
  try {
    const { year, month } = req.params;
    
    // Calculate date range for the month
    const startDate = new Date(Number(year), Number(month) - 1, 1);
    const endDate = new Date(Number(year), Number(month), 0, 23, 59, 59);

    // Order revenue for the month
    const orderRevenue = await Order.aggregate([
      { 
        $match: { 
          createdAt: { $gte: startDate, $lte: endDate },
          status: { $ne: 'cancelled' }
        } 
      },
      { $group: { _id: null, totalRevenue: { $sum: '$total' } } }
    ]);

    res.json({
      year: Number(year),
      month: Number(month),
      orderRevenue: orderRevenue[0]?.totalRevenue || 0,
    });
  } catch (error) {
    console.error('Get revenue by month error:', error);
    res.status(500).json({ message: 'Server error while fetching revenue' });
  }
};

// Gift points to multiple users
exports.giftPoints = async (req, res) => {
  const Notification = require('../models/Notification');
  const Points = require('../models/Points');
  const { sendCustomMessage, isWhatsAppReady } = require('../services/whatsappService');
  
  try {
    const { userIds, points, message } = req.body;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ message: 'Please select at least one user' });
    }
    
    if (!points || points <= 0) {
      return res.status(400).json({ message: 'Points must be a positive number' });
    }
    
    const results = {
      success: [],
      failed: []
    };
    
    for (const userId of userIds) {
      try {
        // Get user details
        const user = await User.findById(userId);
        if (!user) {
          console.error(`User ${userId} not found`);
          results.failed.push(userId);
          continue;
        }

        // Find or create Points record
        let pointsRecord = await Points.findOne({ userId });
        if (!pointsRecord) {
          pointsRecord = new Points({ userId, totalPoints: 0 });
        }
        
        // Add points
        pointsRecord.totalPoints += points;
        pointsRecord.pointsHistory.push({
          points: points,
          action: 'admin_gift',
          description: message || 'Free points gift from Vita',
          date: new Date()
        });
        await pointsRecord.save();
        
        // Update user's total points
        await User.findByIdAndUpdate(userId, { 
          $inc: { totalPoints: points } 
        });
        
        // Create notification for the user
        const notification = new Notification({
          user: userId,
          type: 'points_gift',
          message: message || `🎁 You received ${points} free points as a gift!`,
          isRead: false
        });
        await notification.save();
        
        // Send WhatsApp message
        const { getWhatsAppStatus } = require('../services/whatsappService');
        const whatsappStatus = await getWhatsAppStatus();
        console.log(`Checking WhatsApp for user ${userId}: status=${JSON.stringify(whatsappStatus)}, mobileNumber=${user.mobileNumber}`);
        if (whatsappStatus.ready && whatsappStatus.initialized && user.mobileNumber) {
          try {
            let whatsappMessage = `🎉 تهانينا! لقد حصلت على ${points} نقطة كـ${message || 'نقاط ترحيبية مجانية'}!\n\n`;
            
            if (!user.isPhoneVerified) {
              whatsappMessage += `⚠️ يرجى تسجيل الدخول والتحقق من رقم هاتفك للحصول على النقاط المجانية الآن!`;
            }
            
            console.log(`Sending WhatsApp message to ${user.mobileNumber}: ${whatsappMessage}`);
            await sendCustomMessage(user.mobileNumber, whatsappMessage);
            console.log(`WhatsApp message sent successfully to user ${userId} for ${points} points`);
          } catch (whatsappError) {
            console.error(`Failed to send WhatsApp message to user ${userId}:`, whatsappError.message);
            // Don't fail the whole operation if WhatsApp fails
          }
        } else {
          console.log(`Skipping WhatsApp for user ${userId}: isReady=${await isWhatsAppReady()}, hasMobile=${!!user.mobileNumber}`);
        }
        
        results.success.push(userId);
      } catch (err) {
        console.error(`Failed to gift points to user ${userId}:`, err);
        results.failed.push(userId);
      }
    }
    
    res.json({
      message: `Successfully gifted ${points} points to ${results.success.length} user(s)`,
      success: results.success.length,
      failed: results.failed.length,
      results
    });
  } catch (error) {
    console.error('Gift points error:', error);
    res.status(500).json({ message: 'Server error while gifting points' });
  }
};

// Search users for gift points (lightweight endpoint)
exports.searchUsersForGift = async (req, res) => {
  try {
    const { search, role } = req.query;
    
    let query = {};
    
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { mobileNumber: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (role && role !== 'all') {
      query.role = role;
    }
    
    const users = await User.find(query)
      .select('_id fullName mobileNumber email role totalPoints profileImage')
      .limit(50)
      .sort({ fullName: 1 });
    
    res.json(users);
  } catch (error) {
    console.error('Search users for gift error:', error);
    if (error && error.stack) {
      console.error(error.stack);
    }
    res.status(500).json({ message: 'Server error while searching users', error: error.message });
  }
};

exports.getPotentialClients = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 25,
      city,
      source = 'all',
      search = '',
      refresh = 'false',
    } = req.query;

    const currentPage = Math.max(Number(page) || 1, 1);
    const pageLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const normalizedCity = String(city || '').trim();
    const normalizedSource = String(source || 'all');
    const searchTerm = String(search || '').trim().toLowerCase();

    const allLeads = await getPotentialClientsData(refresh === 'true');
    const statuses = await PotentialClientStatus.find({
      sourceKey: { $in: allLeads.map((lead) => lead.sourceKey) },
    }).lean();
    const statusMap = new Map(statuses.map((item) => [`${item.source}:${item.sourceKey}`, item.status]));

    let filtered = allLeads.map((lead) => ({
      ...lead,
      status: statusMap.get(`${lead.source}:${lead.sourceKey}`) || 'none',
    }));

    if (normalizedSource !== 'all') {
      filtered = filtered.filter((lead) => lead.source === normalizedSource);
    }

    if (normalizedCity) {
      filtered = filtered.filter((lead) => lead.city === normalizedCity);
    }

    if (searchTerm) {
      filtered = filtered.filter((lead) => [
        lead.name,
        lead.phone,
        lead.address,
        lead.specialty,
        lead.city,
      ].some((value) => String(value || '').toLowerCase().includes(searchTerm)));
    }

    const cities = Array.from(new Set(allLeads.map((lead) => lead.city).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ar'));
    const total = filtered.length;
    const totalPages = Math.max(Math.ceil(total / pageLimit), 1);
    const leads = filtered.slice((currentPage - 1) * pageLimit, currentPage * pageLimit);

    res.json({
      leads,
      cities,
      total,
      totalPages,
      currentPage,
      limit: pageLimit,
      fetchedAt: potentialClientsCache.fetchedAt,
    });
  } catch (error) {
    console.error('Get potential clients error:', error);
    res.status(500).json({ message: 'Server error while fetching potential clients', error: error.message });
  }
};

exports.updatePotentialClientStatus = async (req, res) => {
  try {
    const { source, sourceKey, status, adminId } = req.body;

    if (!['smarthealth', 'ppa'].includes(source) || !sourceKey) {
      return res.status(400).json({ message: 'Invalid potential client reference' });
    }

    if (!leadStatusValues.includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const update = {
      status,
      updatedBy: adminId || undefined,
    };

    const savedStatus = await PotentialClientStatus.findOneAndUpdate(
      { source, sourceKey },
      update,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ message: 'Status updated', status: savedStatus.status });
  } catch (error) {
    console.error('Update potential client status error:', error);
    res.status(500).json({ message: 'Server error while updating potential client status', error: error.message });
  }
};

exports.getDemoRequests = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 25,
      status = 'all',
      search = '',
    } = req.query;

    const currentPage = Math.max(Number(page) || 1, 1);
    const pageLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const query = {};

    if (status !== 'all') {
      if (status === 'open') {
        query.status = { $ne: 'closed' };
      } else if (!demoRequestStatusValues.includes(status)) {
        return res.status(400).json({ message: 'Invalid demo request status' });
      } else {
        query.status = status;
      }
    }

    const searchTerm = String(search || '').trim();
    if (searchTerm) {
      const searchRegex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { organization: searchRegex },
        { contact: searchRegex },
        { phone: searchRegex },
        { email: searchRegex },
        { country: searchRegex },
        { type: searchRegex },
        { size: searchRegex },
        { time: searchRegex },
        { message: searchRegex },
      ];
    }

    const [requests, total, openTotal] = await Promise.all([
      DemoRequest.find(query)
        .populate('handledBy', 'name email mobileNumber role')
        .sort({ createdAt: -1 })
        .skip((currentPage - 1) * pageLimit)
        .limit(pageLimit)
        .lean(),
      DemoRequest.countDocuments(query),
      DemoRequest.countDocuments({ status: { $ne: 'closed' } }),
    ]);

    res.json({
      requests,
      total,
      openTotal,
      totalPages: Math.max(Math.ceil(total / pageLimit), 1),
      currentPage,
      limit: pageLimit,
    });
  } catch (error) {
    console.error('Get demo requests error:', error);
    res.status(500).json({ message: 'Server error while fetching demo requests', error: error.message });
  }
};

exports.updateDemoRequestStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes, adminId } = req.body;

    if (!demoRequestStatusValues.includes(status)) {
      return res.status(400).json({ message: 'Invalid demo request status' });
    }

    const update = {
      status,
      handledAt: new Date(),
    };

    if (typeof notes === 'string') {
      update.notes = notes.trim();
    }

    if (adminId) {
      update.handledBy = adminId;
    }

    const demoRequest = await DemoRequest.findByIdAndUpdate(id, update, { new: true })
      .populate('handledBy', 'name email mobileNumber role');

    if (!demoRequest) {
      return res.status(404).json({ message: 'Demo request not found' });
    }

    res.json({ message: 'Demo request status updated', demoRequest });
  } catch (error) {
    console.error('Update demo request status error:', error);
    res.status(500).json({ message: 'Server error while updating demo request status', error: error.message });
  }
};

exports.getPointSettings = async (req, res) => {
  try {
    const settings = await PointSettings.findOneAndUpdate(
      { key: 'default' },
      { $setOnInsert: { pointValueIls: 0.1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({
      pointValueIls: settings.pointValueIls,
      updatedAt: settings.updatedAt,
    });
  } catch (error) {
    console.error('Get admin point settings error:', error);
    res.status(500).json({ message: 'Server error while fetching point settings' });
  }
};

exports.updatePointSettings = async (req, res) => {
  try {
    const pointValueIls = Number(req.body?.pointValueIls);

    if (!Number.isFinite(pointValueIls) || pointValueIls < 0) {
      return res.status(400).json({ message: 'pointValueIls must be a positive number' });
    }

    const settings = await PointSettings.findOneAndUpdate(
      { key: 'default' },
      {
        pointValueIls,
        updatedBy: req.user?._id,
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.json({
      message: 'Point settings updated',
      pointValueIls: settings.pointValueIls,
      updatedAt: settings.updatedAt,
    });
  } catch (error) {
    console.error('Update admin point settings error:', error);
    res.status(500).json({ message: 'Server error while updating point settings' });
  }
};

exports.getLandingAnalytics = async (req, res) => {
  try {
    const now = new Date();
    const startDate = req.query.startDate ? new Date(req.query.startDate) : new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
    const endDate = req.query.endDate ? new Date(req.query.endDate) : now;

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date range' });
    }

    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);

    const rangeMatch = {
      occurredAt: { $gte: startDate, $lte: endDate },
      eventType: { $in: ['visit', 'signup'] },
    };

    const [totalVisits, totalSignups, grouped, latestSignups] = await Promise.all([
      LandingAnalyticsEvent.countDocuments({ eventType: 'visit', occurredAt: rangeMatch.occurredAt }),
      LandingAnalyticsEvent.countDocuments({ eventType: 'signup', occurredAt: rangeMatch.occurredAt }),
      LandingAnalyticsEvent.aggregate([
        { $match: rangeMatch },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$occurredAt' } },
              eventType: '$eventType',
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.date': 1 } },
      ]),
      LandingAnalyticsEvent.find({ eventType: 'signup', occurredAt: rangeMatch.occurredAt })
        .sort({ occurredAt: -1 })
        .limit(10)
        .select('visitId role country city occurredAt userId')
        .lean(),
    ]);

    const dailyMap = new Map();
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const key = cursor.toISOString().slice(0, 10);
      dailyMap.set(key, { date: key, visits: 0, signups: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }

    grouped.forEach((item) => {
      const date = item._id.date;
      if (!dailyMap.has(date)) {
        dailyMap.set(date, { date, visits: 0, signups: 0 });
      }
      const row = dailyMap.get(date);
      if (item._id.eventType === 'visit') row.visits = item.count;
      if (item._id.eventType === 'signup') row.signups = item.count;
    });

    res.json({
      startDate,
      endDate,
      totalVisits,
      totalSignups,
      conversionRate: totalVisits > 0 ? Number(((totalSignups / totalVisits) * 100).toFixed(2)) : 0,
      daily: Array.from(dailyMap.values()),
      latestSignups,
    });
  } catch (error) {
    console.error('Get landing analytics error:', error);
    res.status(500).json({ message: 'Server error while fetching landing analytics' });
  }
};
