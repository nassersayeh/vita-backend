// Test script to verify the API returns correct company names
const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceClaim = require('./models/InsuranceClaim');
const InsuranceCompany = require('./models/InsuranceCompany');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function test() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Simulate the API response for union/all-claims
    console.log('=== Simulating API Response: GET /insurance-claims/union/all-claims ===\n');

    const allClaims = await InsuranceClaim.find({ status: { $ne: 'draft' } })
      .select('-attachmentData')
      .populate('insuranceCompanyId', 'nameAr name');

    const stats = {
      totalClaims: allClaims.length,
      totalValue: allClaims.reduce((sum, c) => sum + (c.claimsValue || 0), 0),
      pending: allClaims.filter(c => c.status === 'pending').length,
      underReview: allClaims.filter(c => c.status === 'under_review').length,
      rejected: allClaims.filter(c => c.status === 'rejected').length,
      paid: allClaims.filter(c => c.status === 'paid').length,
      paidValue: allClaims.filter(c => c.status === 'paid').reduce((sum, c) => sum + (c.paidAmount || c.claimsValue || 0), 0),
      uniquePharmacies: [...new Set(allClaims.map(c => c.pharmacyId?.toString()))].length,
      uniqueCompanies: [...new Set(allClaims.map(c => c.insuranceCompanyId?._id?.toString() || c.insuranceCompany))].length,
    };

    console.log('Stats:', JSON.stringify(stats, null, 2));
    console.log('');

    // Per-company breakdown
    const companyBreakdown = {};
    allClaims.forEach(c => {
      const companyName = c.insuranceCompanyId?.nameAr || c.insuranceCompanyId?.name || c.insuranceCompany;
      const companyKey = c.insuranceCompanyId?._id?.toString() || companyName;
      
      if (!companyBreakdown[companyKey]) {
        companyBreakdown[companyKey] = { 
          name: companyName,
          total: 0, 
          value: 0, 
          pending: 0, 
          paid: 0, 
          rejected: 0 
        };
      }
      companyBreakdown[companyKey].total++;
      companyBreakdown[companyKey].value += c.claimsValue || 0;
      if (c.status === 'pending' || c.status === 'under_review') companyBreakdown[companyKey].pending++;
      if (c.status === 'paid') companyBreakdown[companyKey].paid++;
      if (c.status === 'rejected') companyBreakdown[companyKey].rejected++;
    });

    // Transform breakdown to use company names as keys
    const transformedBreakdown = {};
    Object.entries(companyBreakdown).forEach(([key, data]) => {
      transformedBreakdown[data.name] = {
        total: data.total,
        value: data.value,
        pending: data.pending,
        paid: data.paid,
        rejected: data.rejected
      };
    });

    console.log('Company Breakdown:');
    Object.entries(transformedBreakdown).forEach(([company, data]) => {
      console.log(`\n${company}`);
      console.log(`  إجمالي: ${data.total}`);
      console.log(`  معلقة: ${data.pending}`);
      console.log(`  مدفوعة: ${data.paid}`);
      console.log(`  مرفوضة: ${data.rejected}`);
    });

    console.log('\n✅ API Response Format Test Complete');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

test();
