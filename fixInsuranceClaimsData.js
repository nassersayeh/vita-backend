// Fix insurance claims data - ensure proper company linking
const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceClaim = require('./models/InsuranceClaim');
const InsuranceCompany = require('./models/InsuranceCompany');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function fixData() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get all insurance companies
    const companies = await InsuranceCompany.find().lean();
    console.log(`Found ${companies.length} insurance companies\n`);

    // Get all claims
    const allClaims = await InsuranceClaim.find();
    console.log(`Found ${allClaims.length} total claims\n`);

    // Create a map of company names to IDs with smart matching
    const companyMap = {};
    companies.forEach(company => {
      // Map both nameAr and name to the company ID
      if (company.nameAr) {
        companyMap[company.nameAr] = company._id;
      }
      if (company.name) {
        companyMap[company.name] = company._id;
      }
    });

    // Function to find company ID from a claim company name (handles partial matches)
    const findCompanyId = (claimCompanyName) => {
      // First try exact match
      if (companyMap[claimCompanyName]) {
        return companyMap[claimCompanyName];
      }

      // Try to find by partial match
      for (const company of companies) {
        const nameAr = company.nameAr || '';
        const nameEn = company.name || '';
        
        // Check if the claim company name contains the stored company name
        if (nameAr && claimCompanyName.includes(nameAr)) return company._id;
        if (nameEn && claimCompanyName.includes(nameEn)) return company._id;
        
        // Check if the stored company name contains the claim company name
        if (nameAr && nameAr.includes(claimCompanyName)) return company._id;
        if (nameEn && nameEn.includes(claimCompanyName)) return company._id;
      }

      return null;
    };

    console.log('Company Name to ID mapping:');
    Object.entries(companyMap).forEach(([name, id]) => {
      console.log(`  "${name}" -> ${id}`);
    });
    console.log('');

    // Identify claims without proper insuranceCompanyId
    const claimsToFix = [];
    const unfixableClaims = [];

    allClaims.forEach(claim => {
      if (!claim.insuranceCompanyId || !mongoose.Types.ObjectId.isValid(claim.insuranceCompanyId)) {
        const claimCompanyName = claim.insuranceCompany;
        const foundCompanyId = findCompanyId(claimCompanyName);
        
        if (foundCompanyId) {
          claimsToFix.push({
            id: claim._id,
            oldCompanyId: claim.insuranceCompanyId,
            newCompanyId: foundCompanyId,
            companyName: claimCompanyName
          });
        } else {
          unfixableClaims.push({
            id: claim._id,
            companyName: claimCompanyName
          });
        }
      }
    });

    console.log(`\n📊 Claims Analysis:`);
    console.log(`  ✅ Claims with valid insuranceCompanyId: ${allClaims.length - claimsToFix.length - unfixableClaims.length}`);
    console.log(`  🔧 Claims to fix (found matching company): ${claimsToFix.length}`);
    console.log(`  ❌ Claims unfixable (no matching company found): ${unfixableClaims.length}`);

    if (unfixableClaims.length > 0) {
      console.log('\n❌ Unfixable claims:');
      unfixableClaims.forEach(claim => {
        console.log(`  - Claim ID: ${claim.id}, Company Name: "${claim.companyName}"`);
      });
    }

    // Fix the claims
    if (claimsToFix.length > 0) {
      console.log(`\n🔄 Fixing ${claimsToFix.length} claims...\n`);
      
      for (const claimFix of claimsToFix) {
        await InsuranceClaim.updateOne(
          { _id: claimFix.id },
          { insuranceCompanyId: claimFix.newCompanyId }
        );
        console.log(`  ✅ Fixed: "${claimFix.companyName}" (${claimFix.id})`);
      }
    }

    // Get updated claims and show company breakdown
    const updatedClaims = await InsuranceClaim.find()
      .populate('insuranceCompanyId', 'nameAr name _id');

    console.log('\n\n📋 Final Company Breakdown:\n');
    const companyBreakdown = {};
    updatedClaims.forEach(claim => {
      const companyName = claim.insuranceCompanyId?.nameAr || claim.insuranceCompanyId?.name || claim.insuranceCompany;
      if (!companyBreakdown[companyName]) {
        companyBreakdown[companyName] = { total: 0, pending: 0, paid: 0, rejected: 0, draft: 0 };
      }
      companyBreakdown[companyName].total++;
      if (claim.status === 'pending') companyBreakdown[companyName].pending++;
      else if (claim.status === 'paid') companyBreakdown[companyName].paid++;
      else if (claim.status === 'rejected') companyBreakdown[companyName].rejected++;
      else if (claim.status === 'draft') companyBreakdown[companyName].draft++;
    });

    Object.entries(companyBreakdown)
      .sort((a, b) => b[1].total - a[1].total)
      .forEach(([company, data]) => {
        console.log(`${company}`);
        console.log(`  إجمالي: ${data.total}, معلقة: ${data.pending}, مدفوعة: ${data.paid}, مرفوضة: ${data.rejected}, مسودة: ${data.draft}`);
      });

    console.log('\n✅ Data fix complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

fixData();
