const express = require('express');
const router = express.Router();
const Financial = require('../models/Financial');
const Payment = require('../models/Payment');
const User = require('../models/User');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose'); // Added mongoose import
const { sendDoctorWhatsAppMessage } = require('../services/doctorWhatsappService');
// Fetch financial data for a pharmacy, filter by month/year
router.get('/pharmacies/:pharmacyId/financial',  async (req, res) => {
  try {
    const { month, year } = req.query; // Optional query params: month (1-12), year (e.g., 2025)

    // Default to current month/year if not provided
    const now = new Date();
    const filterYear = year ? parseInt(year) : now.getFullYear();
    const filterMonth = month ? parseInt(month) : now.getMonth() + 1; // 1-12

    // Validate month and year
    if (month && (filterMonth < 1 || filterMonth > 12)) {
      return res.status(400).json({ message: 'الشهر يجب أن يكون بين 1 و 12' });
    }
    if (year && (filterYear < 1900 || filterYear > now.getFullYear() + 1)) {
      return res.status(400).json({ message: 'السنة غير صالحة' });
    }

    let financial = await Financial.findOne({ pharmacyId: req.params.pharmacyId })
      .populate('transactions.orderId', 'totalAmount status')
      .populate('debts.orderId', 'totalAmount status');

    if (!financial) {
      financial = new Financial({ pharmacyId: req.params.pharmacyId });
      await financial.save();
    }

    // Filter transactions and expenses by month/year (current month)
    const filteredTransactions = financial.transactions.filter((trans) => {
      const transDate = new Date(trans.date);
      return transDate.getFullYear() === filterYear && transDate.getMonth() + 1 === filterMonth;
    });

    const filteredExpenses = financial.expenses.filter((exp) => {
      const expDate = new Date(exp.date);
      return expDate.getFullYear() === filterYear && expDate.getMonth() + 1 === filterMonth;
    });

    // Calculate previous month dates for comparison
    let prevMonth = filterMonth - 1;
    let prevYear = filterYear;
    if (prevMonth === 0) {
      prevMonth = 12;
      prevYear = filterYear - 1;
    }

    // Filter transactions for previous month
    const prevMonthTransactions = financial.transactions.filter((trans) => {
      const transDate = new Date(trans.date);
      return transDate.getFullYear() === prevYear && transDate.getMonth() + 1 === prevMonth;
    });

    // Calculate monthly totals
    const monthlyEarnings = filteredTransactions.reduce((sum, trans) => sum + trans.amount, 0);
    const monthlyExpenses = filteredExpenses.reduce((sum, exp) => sum + exp.amount, 0);

    // Calculate previous month earnings
    const prevMonthEarnings = prevMonthTransactions.reduce((sum, trans) => sum + trans.amount, 0);

    // Calculate percentage change from previous month
    let percentageChange = 0;
    if (prevMonthEarnings > 0) {
      percentageChange = ((monthlyEarnings - prevMonthEarnings) / prevMonthEarnings) * 100;
    } else if (monthlyEarnings > 0) {
      percentageChange = 100; // If no previous month data but has current month data, show 100% increase
    }

    // Debts are not filtered by month (show all debts)
    const formattedFinancial = {
      total: monthlyEarnings, // Current month revenue (for dashboard card)
      totalEarnings: monthlyEarnings,
      totalExpenses: monthlyExpenses,
      previousMonthEarnings: prevMonthEarnings,
      percentageChange: Math.round(percentageChange * 10) / 10, // Round to 1 decimal place
      transactions: filteredTransactions.map((trans) => ({
        ...trans.toObject(),
        orderId: trans.orderId ? { _id: trans.orderId._id, totalAmount: trans.orderId.totalAmount, status: trans.orderId.status } : null,
      })),
      expenses: filteredExpenses,
      debts: financial.debts.map((debt) => ({
        ...debt.toObject(),
        orderId: debt.orderId ? { _id: debt.orderId._id, totalAmount: debt.orderId.totalAmount, status: debt.orderId.status } : null,
      })),
    };

    res.status(200).json(formattedFinancial);
  } catch (error) {
    res.status(500).json({ message: 'خطأ في جلب البيانات المالية', error });
  }
});

// Add income for a pharmacy
router.post(
    '/pharmacies/:pharmacyId/financial/income',
    [
      body('amount').isFloat({ min: 0 }).withMessage('المبلغ يجب أن يكون رقمًا إيجابيًا'),
      body('paymentMethod')
        .isIn(['Cash', 'Visa', 'Insurance','BankTransfer'])
        .withMessage('طريقة الدفع غير صالحة'),
      body('orderId')
        .optional()
        .isMongoId()
        .withMessage('معرف الطلب غير صالح')
        .custom(async (value, { req }) => {
          if (value) {
            const order = await Payment.findById(value);
            if (!order) throw new Error('الطلب غير موجود');
          }
          return true;
        }),
    ],
    async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
  
      try {
        const { amount, description, date, orderId, paymentMethod } = req.body;
        const pharmacyId = req.params.pharmacyId;
        
        // if (req.user._id.toString() !== pharmacyId) {
        //   return res.status(403).json({ message: 'غير مخول لإضافة دخل لهذا الصيدلية' });
        // }
  
        let financial = await Financial.findOne({ pharmacyId });
  
        if (!financial) {
          financial = new Financial({ pharmacyId });
          await financial.save();
        }
        const order = await Payment.findById(orderId)
        const transactionData = {
          amount: parseFloat(amount),
          description: description || `دخل من طلب #${orderId || 'يدوي'}`,
          date: date ? new Date(date) : new Date(),
          orderId: orderId,
          paymentMethod,
          patientId:order.user
        };
        if (transactionData.amount <= 0) {
          return res.status(400).json({ message: 'المبلغ يجب أن يكون إيجابيًا' });
        }
  
        financial.totalEarnings += transactionData.amount;
        financial.transactions.push(transactionData);
        await financial.save();
  
        if (orderId) {
          await Payment.findByIdAndUpdate(orderId, { status: 'paid' }, { new: true });
        }
  
        const populatedFinancial = await Financial.findOne({ pharmacyId })
          .populate({
            path: 'transactions.orderId',
            select: 'totalAmount status _id user', // Ensure user is selected
            populate: { path: 'user', select: 'fullName' }, // Populate user with fullName
          })
          .populate({
            path: 'debts.orderId',
            select: 'totalAmount status _id',
          })
          .lean();
  
        if (!populatedFinancial) {
          throw new Error('Failed to retrieve financial data after save');
        }
  
        console.log('Populated Transactions:', populatedFinancial.transactions); // Debug log
  
        const formattedFinancial = {
          ...populatedFinancial,
          transactions: (populatedFinancial.transactions || []).map((trans) => {
            const orderIdData = trans.orderId
              ? {
                  _id: trans.orderId._id,
                  totalAmount: trans.orderId.totalAmount,
                  status: trans.orderId.status,
                  user: trans.orderId.user ? trans.orderId.user.fullName : 'غير معروف',
                }
              : null;
            return {
              ...trans,
              orderId: orderIdData,
            };
          }),
          debts: (populatedFinancial.debts || []).map((debt) => {
            const orderIdData = debt.orderId
              ? { _id: debt.orderId._id, totalAmount: debt.orderId.totalAmount, status: debt.orderId.status }
              : null;
            return {
              ...debt,
              orderId: orderIdData,
            };
          }),
        };
  
        res.status(201).json({ message: 'تم إضافة الدخل بنجاح', financial: formattedFinancial });
      } catch (error) {
        console.error('Error adding income:', error);
        res.status(500).json({ message: 'خطأ في إضافة الدخل', error: error.message });
      }
    }
  );
    // Delete a specific transaction (income)
    router.delete(
        '/pharmacies/:pharmacyId/financial/income/:transactionId',
        async (req, res) => {
          try {
            console.log('DELETE request received:', req.params); // Debug log
            const { pharmacyId, transactionId } = req.params;
      
            const financial = await Financial.findOne({ pharmacyId });
      
            if (!financial) {
              return res.status(404).json({ message: 'لا توجد بيانات مالية لهذا الصيدلية' });
            }
      
            const transactionIndex = financial.transactions.findIndex(
              (trans) => trans._id.toString() === transactionId
            );
      
            if (transactionIndex === -1) {
              return res.status(404).json({ message: 'المعاملة غير موجودة' });
            }
      
            const transaction = financial.transactions[transactionIndex];
            financial.totalEarnings -= transaction.amount;
            financial.transactions.splice(transactionIndex, 1);
            await financial.save();
      
            const populatedFinancial = await Financial.findOne({ pharmacyId })
              .populate({
                path: 'transactions.orderId',
                select: 'totalAmount status _id user',
                populate: { path: 'user', select: 'fullName' },
              })
              .populate({
                path: 'debts.orderId',
                select: 'totalAmount status _id',
              })
              .lean();
      
            res.status(200).json({ message: 'تم حذف الدخل بنجاح', financial: populatedFinancial });
          } catch (error) {
            console.error('Error deleting income:', error);
            res.status(500).json({ message: 'خطأ في حذف الدخل', error: error.message });
          }
        }
      );
// Add expense for a pharmacy
router.post('/pharmacies/:pharmacyId/financial/expense', [
  body('amount').isFloat({ min: 0 }).withMessage('المبلغ يجب أن يكون رقمًا إيجابيًا'),
  body('category').isIn(['Inventory', 'Utilities', 'Supplier Payments', 'Other']).withMessage('الفئة غير صالحة'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { amount, description, date, category } = req.body;
    if (req.user._id.toString() !== req.params.pharmacyId) {
      return res.status(403).json({ message: 'غير مخول لإضافة مصروف لهذا الصيدلية' });
    }
    let financial = await Financial.findOne({ pharmacyId: req.params.pharmacyId });
    if (!financial) {
      financial = new Financial({ pharmacyId: req.params.pharmacyId });
    }
    financial.totalExpenses += amount;
    financial.expenses.push({ amount, description, date, category });
    await financial.save();
    const populatedFinancial = await Financial.findOne({ pharmacyId: req.params.pharmacyId })
      .populate('transactions.orderId', 'totalAmount status')
      .populate('debts.orderId', 'totalAmount status');
    const formattedFinancial = {
      ...populatedFinancial.toObject(),
      transactions: populatedFinancial.transactions.map((trans) => ({
        ...trans.toObject(),
        orderId: trans.orderId ? { _id: trans.orderId._id, totalAmount: trans.orderId.totalAmount, status: trans.orderId.status } : null,
      })),
      debts: populatedFinancial.debts.map((debt) => ({
        ...debt.toObject(),
        orderId: debt.orderId ? { _id: debt.orderId._id, totalAmount: debt.orderId.totalAmount, status: debt.orderId.status } : null,
      })),
    };
    res.status(201).json({ message: 'تم إضافة المصروف بنجاح', financial: formattedFinancial });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في إضافة المصروف', error });
  }
});

// Add debt for a pharmacy
router.post('/pharmacies/:pharmacyId/financial/debt', [
  body('amount').isFloat({ min: 0 }).withMessage('المبلغ يجب أن يكون رقمًا إيجابيًا'),
  body('orderId').optional().isMongoId().withMessage('معرف الطلب غير صالح'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { amount, description, date, orderId } = req.body;
    if (req.user._id.toString() !== req.params.pharmacyId) {
      return res.status(403).json({ message: 'غير مخول لإضافة دين لهذا الصيدلية' });
    }
    let financial = await Financial.findOne({ pharmacyId: req.params.pharmacyId });
    if (!financial) {
      financial = new Financial({ pharmacyId: req.params.pharmacyId });
    }
    financial.debts.push({ amount, description, date, orderId, status: 'pending' });
    await financial.save();
    const populatedFinancial = await Financial.findOne({ pharmacyId: req.params.pharmacyId })
      .populate('transactions.orderId', 'totalAmount status')
      .populate('debts.orderId', 'totalAmount status');
    const formattedFinancial = {
      ...populatedFinancial.toObject(),
      transactions: populatedFinancial.transactions.map((trans) => ({
        ...trans.toObject(),
        orderId: trans.orderId ? { _id: trans.orderId._id, totalAmount: trans.orderId.totalAmount, status: trans.orderId.status } : null,
      })),
      debts: populatedFinancial.debts.map((debt) => ({
        ...debt.toObject(),
        orderId: debt.orderId ? { _id: debt.orderId._id, totalAmount: debt.orderId.totalAmount, status: debt.orderId.status } : null,
      })),
    };
    res.status(201).json({ message: 'تم إضافة الدين بنجاح', financial: formattedFinancial });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في إضافة الدين', error });
  }
});

// Pay debt for a pharmacy (partial or full payment)
router.post('/pharmacies/:pharmacyId/financial/debt/:debtId/pay', [
  body('paymentMethod').isIn(['Cash', 'Card', 'Visa', 'Insurance']).withMessage('طريقة الدفع غير صالحة'),
  body('amount').isFloat({ min: 0 }).withMessage('المبلغ يجب أن يكون رقمًا إيجابيًا'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { paymentMethod, amount } = req.body;
    const paymentAmount = parseFloat(amount);

    const financial = await Financial.findOne({ pharmacyId: req.params.pharmacyId });
    if (!financial) {
      return res.status(404).json({ message: 'البيانات المالية غير موجودة' });
    }

    if (req.user._id.toString() !== req.params.pharmacyId) {
      return res.status(403).json({ message: 'غير مخول لتسديد الدين لهذا الصيدلية' });
    }

    const debt = financial.debts.id(req.params.debtId);
    if (!debt) {
      return res.status(404).json({ message: 'الدين غير موجود' });
    }

    if (debt.status === 'paid') {
      return res.status(400).json({ message: 'الدين تم تسديده مسبقاً' });
    }

    if (paymentAmount > debt.amount) {
      return res.status(400).json({ message: 'المبلغ المدفوع لا يمكن أن يتجاوز المبلغ المستحق' });
    }

    // Update debt amount
    const remainingAmount = debt.amount - paymentAmount;
    if (remainingAmount <= 0) {
      debt.status = 'paid';
      debt.amount = 0;
    } else {
      debt.amount = remainingAmount;
    }

    // Add the payment as a transaction
    financial.totalEarnings += paymentAmount;
    financial.transactions.push({
      amount: paymentAmount,
      description: `دفع جزء من دين: ${debt.description}`,
      date: new Date(),
      orderId: debt.orderId,
      paymentMethod,
    });

    await financial.save();

    const populatedFinancial = await Financial.findOne({ pharmacyId: req.params.pharmacyId })
      .populate('transactions.orderId', 'totalAmount status')
      .populate('debts.orderId', 'totalAmount status');
    const formattedFinancial = {
      ...populatedFinancial.toObject(),
      transactions: populatedFinancial.transactions.map((trans) => ({
        ...trans.toObject(),
        orderId: trans.orderId ? { _id: trans.orderId._id, totalAmount: trans.orderId.totalAmount, status: trans.orderId.status } : null,
      })),
      debts: populatedFinancial.debts.map((debt) => ({
        ...debt.toObject(),
        orderId: debt.orderId ? { _id: debt.orderId._id, totalAmount: debt.orderId.totalAmount, status: debt.orderId.status } : null,
      })),
    };

    res.status(200).json({ message: 'تم تسديد الدين بنجاح', financial: formattedFinancial });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في تسديد الدين', error });
  }
});

// Fetch financial data for a doctor, filter by month/year (unchanged)
router.get('/doctors/:doctorId/financial', async (req, res) => {
  try {
    const { month, year, allTransactions } = req.query; // Optional query params: month (1-12), year (e.g., 2025), allTransactions (boolean)

    console.log('Financial API called with params:', { month, year, allTransactions, doctorId: req.params.doctorId });

    // Default to current month/year if not provided
    const now = new Date();
    const filterYear = year ? parseInt(year) : now.getFullYear();
    const filterMonth = month ? parseInt(month) : now.getMonth() + 1; // 1-12

    // Validate month and year
    if (month && (filterMonth < 1 || filterMonth > 12)) {
      return res.status(400).json({ message: 'الشهر يجب أن يكون بين 1 و 12' });
    }
    if (year && (filterYear < 1900 || filterYear > now.getFullYear() + 1)) {
      return res.status(400).json({ message: 'السنة غير صالحة' });
    }

    let financial = await Financial.findOne({ doctorId: req.params.doctorId })
      .populate('transactions.patientId', 'fullName')
      .populate('transactions.lastEditedBy', 'fullName')
      .populate('debts.patientId', 'fullName');

    if (!financial) {
      financial = new Financial({ doctorId: req.params.doctorId });
      await financial.save();
    }

    console.log('Found financial record with', financial.transactions.length, 'transactions');

    // Filter transactions and expenses by month/year unless allTransactions is true
    let filteredTransactions = financial.transactions;
    let filteredExpenses = financial.expenses;
    
    if (allTransactions !== 'true') {
      filteredTransactions = financial.transactions.filter((trans) => {
        const transDate = new Date(trans.date);
        return transDate.getFullYear() === filterYear && transDate.getMonth() + 1 === filterMonth;
      });

      filteredExpenses = financial.expenses.filter((exp) => {
        const expDate = new Date(exp.date);
        return expDate.getFullYear() === filterYear && expDate.getMonth() + 1 === filterMonth;
      });
    }

    console.log('Returning', filteredTransactions.length, 'filtered transactions');

    // Calculate totals (monthly or all-time based on filtering)
    const totalEarnings = filteredTransactions.reduce((sum, trans) => sum + trans.amount, 0);
    const totalExpenses = filteredExpenses.reduce((sum, exp) => sum + exp.amount, 0);

    // Debts are not filtered by month (show all debts)
    const formattedFinancial = {
      totalEarnings,
      totalExpenses,
      transactions: filteredTransactions.map((trans) => ({
        ...trans.toObject(),
        patientName: trans.patientId?.fullName || 'غير معروف',
      })),
      expenses: filteredExpenses,
      debts: financial.debts.map((debt) => ({
        ...debt.toObject(),
        patientName: debt.patientId?.fullName || 'غير معروف',
      })),
    };

    res.status(200).json(formattedFinancial);
  } catch (error) {
    console.error('Error fetching financial data:', error);
    res.status(500).json({ message: 'خطأ في جلب البيانات المالية', error });
  }
});

// Get transactions for a specific patient from a doctor
router.get('/doctors/:doctorId/patients/:patientId/transactions', async (req, res) => {
  try {
    const { doctorId, patientId } = req.params;
    
    let financial = await Financial.findOne({ doctorId })
      .populate('transactions.patientId', 'fullName mobileNumber')
      .populate('transactions.lastEditedBy', 'fullName')
      .populate('debts.patientId', 'fullName mobileNumber');

    if (!financial) {
      return res.status(200).json({ 
        transactions: [], 
        debts: [],
        totalPaid: 0,
        totalDebt: 0
      });
    }

    // Filter transactions for this specific patient
    const patientTransactions = financial.transactions.filter(
      trans => trans.patientId && trans.patientId._id.toString() === patientId
    );

    // Filter debts for this specific patient
    const patientDebts = financial.debts.filter(
      debt => debt.patientId && debt.patientId._id.toString() === patientId
    );

    // Calculate totals
    const totalPaid = patientTransactions.reduce((sum, trans) => sum + trans.amount, 0);
    const totalDebt = patientDebts
      .filter(debt => debt.status === 'pending')
      .reduce((sum, debt) => sum + debt.amount, 0);

    const formattedResponse = {
      transactions: patientTransactions.map((trans) => ({
        ...trans.toObject(),
        patientName: trans.patientId?.fullName || 'غير معروف',
      })),
      debts: patientDebts.map((debt) => ({
        ...debt.toObject(),
        patientName: debt.patientId?.fullName || 'غير معروف',
      })),
      totalPaid,
      totalDebt
    };

    res.status(200).json(formattedResponse);
  } catch (error) {
    console.error('Error fetching patient transactions:', error);
    res.status(500).json({ message: 'خطأ في جلب معاملات المريض', error });
  }
});

// Add income for a doctor
router.post('/doctors/:doctorId/financial/income', [
  body('amount').isFloat({ min: 0 }).withMessage('المبلغ يجب أن يكون رقمًا إيجابيًا'),
  body('patientId').notEmpty().withMessage('يجب اختيار مريض'),
  body('paymentMethod').isIn(['Cash', 'Card', 'Visa', 'Insurance', 'BankTransfer']).withMessage('طريقة الدفع غير صالحة'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { amount, description, date, patientId, paymentMethod } = req.body;
    const doctorId = req.params.doctorId;
    
    // Ensure amount is a valid number
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: 'Invalid amount provided' });
    }
    
    let financial = await Financial.findOne({ doctorId });
    if (!financial) {
      financial = new Financial({ doctorId, totalEarnings: 0, totalExpenses: 0 });
    }
    
    // Ensure totalEarnings is a valid number before adding
    if (!Number.isFinite(financial.totalEarnings)) {
      financial.totalEarnings = 0;
    }
    
    const transactionDate = date ? new Date(date) : new Date();
    financial.totalEarnings = financial.totalEarnings + numericAmount;
    financial.transactions.push({ amount: numericAmount, description, date: transactionDate, patientId, paymentMethod });
    await financial.save();
    
    const populatedFinancial = await Financial.findOne({ doctorId })
      .populate('transactions.patientId', 'fullName')
      .populate('debts.patientId', 'fullName');
    const formattedFinancial = {
      ...populatedFinancial.toObject(),
      transactions: populatedFinancial.transactions.map((trans) => ({
        ...trans.toObject(),
        patientName: trans.patientId?.fullName || 'غير معروف',
      })),
      debts: populatedFinancial.debts.map((debt) => ({
        ...debt.toObject(),
        patientName: debt.patientId?.fullName || 'غير معروف',
      })),
    };
    
    // Send WhatsApp receipt message to patient
    try {
      // Fetch patient and doctor details
      const [patient, doctor] = await Promise.all([
        User.findById(patientId).select('fullName mobileNumber'),
        User.findById(doctorId).select('fullName whatsappSession')
      ]);
      
      if (patient && patient.mobileNumber && doctor) {
        // Calculate patient's remaining debt
        const patientDebts = populatedFinancial.debts.filter(
          debt => debt.patientId && debt.patientId._id.toString() === patientId && debt.status === 'pending'
        );
        const totalDebt = patientDebts.reduce((sum, debt) => sum + debt.amount, 0);
        
        // Format date in Arabic
        const formattedDate = transactionDate.toLocaleDateString('ar-EG', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        
        // Build the WhatsApp message in Arabic
        let message = `شكراً لدفعتكم بتاريخ ${formattedDate} بمبلغ ${amount} شيكل.\n`;
        message += `هذا إيصال رسمي.\n`;
        
        if (totalDebt > 0) {
          message += `المبلغ المتبقي عليكم: ${totalDebt} شيكل.\n`;
        }
        
        message += `يمكنك فتح تطبيق فيتا لحجز المواعيد ومشاهدة دفعاتك.\n`;
        message += `شكراً لك.\n`;
        message += `فريق ${doctor.fullName}`;
        
        // Send WhatsApp message from doctor's WhatsApp
        await sendDoctorWhatsAppMessage(doctorId, patient.mobileNumber, message);
        console.log(`✅ WhatsApp payment receipt sent to patient ${patientId}`);
      }
    } catch (whatsappError) {
      // Log the error but don't fail the request - the income was already added successfully
      console.error('Failed to send WhatsApp payment receipt:', whatsappError.message);
    }
    
    res.status(201).json({ message: 'تم إضافة الدخل بنجاح', financial: formattedFinancial });
  } catch (error) {
    console.error('Error adding doctor income:', error);
    res.status(500).json({ message: 'خطأ في إضافة الدخل', error: error.message });
  }
});

// Add expense for a doctor
router.post('/doctors/:doctorId/financial/expense', [
  body('amount').isFloat({ min: 0 }).withMessage('المبلغ يجب أن يكون رقمًا إيجابيًا'),
  body('category').isIn(['General', 'Salary', 'Equipment', 'Utilities', 'Other', 'Inventory', 'Supplier Payments']).withMessage('الفئة غير صالحة'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { amount, description, date, category, employeeId, supplierId, selectedProducts } = req.body;
    let financial = await Financial.findOne({ doctorId: req.params.doctorId });
    if (!financial) {
      financial = new Financial({ doctorId: req.params.doctorId });
    }

    // Validate employee selection for salary
    if (category === 'Salary' && !employeeId) {
      return res.status(400).json({ message: 'يجب اختيار موظف لمصروف الراتب' });
    }

    // Validate supplier selection for supplier-related expenses
    if ((category === 'Equipment' || category === 'Inventory' || category === 'Supplier Payments') && !supplierId) {
      return res.status(400).json({ message: 'يجب اختيار مورد لهذه الفئة من المصروفات' });
    }

    // For supplier-related expenses, validate that supplier belongs to this doctor
    if ((category === 'Equipment' || category === 'Inventory' || category === 'Supplier Payments') && supplierId) {
      const Supplier = require('../models/Supplier');
      const supplier = await Supplier.findOne({ _id: supplierId, createdBy: req.params.doctorId });
      if (!supplier) {
        return res.status(400).json({ message: 'المورد غير موجود أو لا ينتمي إليك' });
      }
    }

    // For salary, validate that employee belongs to this doctor (or is a clinic doctor/staff)
    if (category === 'Salary' && employeeId) {
      const Employee = require('../models/Employee');
      const employee = await Employee.findOne({ userId: employeeId, employerId: req.params.doctorId });
      if (!employee) {
        // Also check if user is a clinic owner and the employeeId is one of their doctors or staff
        const Clinic = require('../models/Clinic');
        const clinic = await Clinic.findOne({ ownerId: req.params.doctorId });
        if (clinic) {
          const isDoctorInClinic = clinic.doctors.some(d => d.doctorId?.toString() === employeeId);
          const isStaffInClinic = clinic.staff?.some(s => s.userId?.toString() === employeeId);
          if (!isDoctorInClinic && !isStaffInClinic) {
            // Also check if it's a valid User in the system (for flexible clinic use)
            const validUser = await User.findById(employeeId);
            if (!validUser) {
              return res.status(400).json({ message: 'الموظف غير موجود أو لا يعمل لديك' });
            }
          }
        } else {
          return res.status(400).json({ message: 'الموظف غير موجود أو لا يعمل لديك' });
        }
      }
    }

    financial.totalExpenses += amount;
    financial.expenses.push({
      amount,
      description,
      date,
      category,
      employeeId: category === 'Salary' ? employeeId : undefined,
      supplierId: (category === 'Equipment' || category === 'Inventory' || category === 'Supplier Payments') ? supplierId : undefined,
      selectedProducts: (category === 'Equipment' || category === 'Inventory' || category === 'Supplier Payments') ? selectedProducts : undefined
    });

    await financial.save();

    const populatedFinancial = await Financial.findOne({ doctorId: req.params.doctorId })
      .populate('expenses.employeeId', 'fullName')
      .populate('expenses.supplierId', 'name')
      .populate('transactions.patientId', 'fullName')
      .populate('debts.patientId', 'fullName');

    const formattedFinancial = {
      ...populatedFinancial.toObject(),
      transactions: populatedFinancial.transactions.map((trans) => ({
        ...trans.toObject(),
        patientName: trans.patientId?.fullName || 'غير معروف',
      })),
      expenses: populatedFinancial.expenses.map((exp) => ({
        ...exp.toObject(),
        employeeName: exp.employeeId?.fullName || undefined,
        supplierName: exp.supplierId?.name || undefined,
      })),
      debts: populatedFinancial.debts.map((debt) => ({
        ...debt.toObject(),
        patientName: debt.patientId?.fullName || 'غير معروف',
      })),
    };

    res.status(201).json({ message: 'تم إضافة المصروف بنجاح', financial: formattedFinancial });
  } catch (error) {
    console.error('Error adding expense:', error);
    res.status(500).json({ message: 'خطأ في إضافة المصروف', error: error.message });
  }
});

// Update expense for a doctor
router.put('/doctors/:doctorId/financial/expense/:expenseId', [
  body('amount').isFloat({ min: 0 }).withMessage('المبلغ يجب أن يكون رقمًا إيجابيًا'),
  body('category').isIn(['General', 'Salary', 'Equipment', 'Utilities', 'Other', 'Inventory', 'Supplier Payments']).withMessage('الفئة غير صالحة'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { amount, description, date, category, employeeId, supplierId, selectedProducts } = req.body;
    const financial = await Financial.findOne({ doctorId: req.params.doctorId });
    if (!financial) {
      return res.status(404).json({ message: 'لم يتم العثور على البيانات المالية' });
    }

    const expense = financial.expenses.id(req.params.expenseId);
    if (!expense) {
      return res.status(404).json({ message: 'لم يتم العثور على المصروف' });
    }

    // Adjust totalExpenses
    financial.totalExpenses = financial.totalExpenses - expense.amount + amount;

    // Update expense fields
    expense.amount = amount;
    expense.description = description;
    expense.date = date;
    expense.category = category;
    expense.employeeId = category === 'Salary' ? employeeId : undefined;
    expense.supplierId = (category === 'Equipment' || category === 'Inventory' || category === 'Supplier Payments') ? supplierId : undefined;
    expense.selectedProducts = (category === 'Equipment' || category === 'Inventory' || category === 'Supplier Payments') ? selectedProducts : undefined;

    await financial.save();

    const populatedFinancial = await Financial.findOne({ doctorId: req.params.doctorId })
      .populate('expenses.employeeId', 'fullName')
      .populate('expenses.supplierId', 'name')
      .populate('transactions.patientId', 'fullName')
      .populate('debts.patientId', 'fullName');

    const formattedFinancial = {
      ...populatedFinancial.toObject(),
      transactions: populatedFinancial.transactions.map((trans) => ({
        ...trans.toObject(),
        patientName: trans.patientId?.fullName || 'غير معروف',
      })),
      expenses: populatedFinancial.expenses.map((exp) => ({
        ...exp.toObject(),
        employeeName: exp.employeeId?.fullName || undefined,
        supplierName: exp.supplierId?.name || undefined,
      })),
      debts: populatedFinancial.debts.map((debt) => ({
        ...debt.toObject(),
        patientName: debt.patientId?.fullName || 'غير معروف',
      })),
    };

    res.json({ message: 'تم تعديل المصروف بنجاح', financial: formattedFinancial });
  } catch (error) {
    console.error('Error updating expense:', error);
    res.status(500).json({ message: 'خطأ في تعديل المصروف', error: error.message });
  }
});

// Delete expense for a doctor
router.delete('/doctors/:doctorId/financial/expense/:expenseId', async (req, res) => {
  try {
    const financial = await Financial.findOne({ doctorId: req.params.doctorId });
    if (!financial) {
      return res.status(404).json({ message: 'لم يتم العثور على البيانات المالية' });
    }

    const expense = financial.expenses.id(req.params.expenseId);
    if (!expense) {
      return res.status(404).json({ message: 'لم يتم العثور على المصروف' });
    }

    // Subtract from total
    financial.totalExpenses -= expense.amount;
    
    // Remove expense
    financial.expenses.pull(req.params.expenseId);
    await financial.save();

    res.json({ message: 'تم حذف المصروف بنجاح' });
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ message: 'خطأ في حذف المصروف', error: error.message });
  }
});

// Add debt for a doctor (unchanged)
router.post('/doctors/:doctorId/financial/debt', [
  body('amount').isFloat({ min: 0 }).withMessage('المبلغ يجب أن يكون رقمًا إيجابيًا'),
  body('patientId').notEmpty().withMessage('يجب اختيار مريض'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { amount, description, date, patientId } = req.body;
    let financial = await Financial.findOne({ doctorId: req.params.doctorId });
    if (!financial) {
      financial = new Financial({ doctorId: req.params.doctorId });
    }
    financial.debts.push({ amount, description, date, patientId, status: 'pending' });
    await financial.save();
    const populatedFinancial = await Financial.findOne({ doctorId: req.params.doctorId })
      .populate('transactions.patientId', 'fullName')
      .populate('debts.patientId', 'fullName');
    const formattedFinancial = {
      ...populatedFinancial.toObject(),
      transactions: populatedFinancial.transactions.map((trans) => ({
        ...trans.toObject(),
        patientName: trans.patientId?.fullName || 'غير معروف',
      })),
      debts: populatedFinancial.debts.map((debt) => ({
        ...debt.toObject(),
        patientName: debt.patientId?.fullName || 'غير معروف',
      })),
    };
    res.status(201).json({ message: 'تم إضافة الدين بنجاح', financial: formattedFinancial });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في إضافة الدين', error });
  }
});

// Pay debt for a doctor (unchanged)
router.post('/doctors/:doctorId/financial/debt/:debtId/pay', [
  body('paymentMethod').isIn(['Cash', 'Card', 'Visa', 'Insurance']).withMessage('طريقة الدفع غير صالحة'),
  body('amount').isFloat({ min: 0 }).withMessage('المبلغ يجب أن يكون رقمًا إيجابيًا'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { paymentMethod, amount } = req.body;
    const paymentAmount = parseFloat(amount);

    const financial = await Financial.findOne({ doctorId: req.params.doctorId });
    if (!financial) {
      return res.status(404).json({ message: 'البيانات المالية غير موجودة' });
    }

    const debt = financial.debts.id(req.params.debtId);
    if (!debt) {
      return res.status(404).json({ message: 'الدين غير موجود' });
    }

    if (debt.status === 'paid') {
      return res.status(400).json({ message: 'الدين تم تسديده مسبقاً' });
    }

    if (paymentAmount > debt.amount) {
      return res.status(400).json({ message: 'المبلغ المدفوع لا يمكن أن يتجاوز المبلغ المستحق' });
    }

    // Update debt amount
    const remainingAmount = debt.amount - paymentAmount;
    if (remainingAmount <= 0) {
      debt.status = 'paid';
      debt.amount = 0;
    } else {
      debt.amount = remainingAmount;
    }

    // Add the payment as a transaction
    financial.totalEarnings += paymentAmount;
    financial.transactions.push({
      amount: paymentAmount,
      description: `دفع جزء من دين: ${debt.description}`,
      date: new Date(),
      patientId: debt.patientId._id || debt.patientId, // Ensure it's an ObjectId
      paymentMethod,
    });

    await financial.save();

    const populatedFinancial = await Financial.findOne({ doctorId: req.params.doctorId })
      .populate('transactions.patientId', 'fullName')
      .populate('debts.patientId', 'fullName');
    const formattedFinancial = {
      ...populatedFinancial.toObject(),
      transactions: populatedFinancial.transactions.map((trans) => ({
        ...trans.toObject(),
        patientName: trans.patientId?.fullName || 'غير معروف',
      })),
      debts: populatedFinancial.debts.map((debt) => ({
        ...debt.toObject(),
        patientName: debt.patientId?.fullName || 'غير معروف',
      })),
    };

    res.status(200).json({ message: 'تم تسديد الدين بنجاح', financial: formattedFinancial });
  } catch (error) {
    res.status(500).json({ message: 'خطأ في تسديد الدين', error });
  }
});

module.exports = router;