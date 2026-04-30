const mongoose = require('mongoose');
require('dotenv').config();

const InsuranceClaim = require('./models/InsuranceClaim');
const InsuranceCompany = require('./models/InsuranceCompany');
const User = require('./models/User');

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net';

async function testCreate() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');
    
    // Find a pharmacy
    const pharmacy = await User.findOne({ role: 'pharmacy' });
    if (!pharmacy) {
      console.log('❌ No pharmacy found');
      process.exit(1);
    }
    
    console.log(`Found pharmacy: ${pharmacy.fullName}`);
    
    // Find an insurance company (use the one with existing claims)
    const company = await InsuranceCompany.findOne({ 
      nameAr: 'جلوب ميد فلسطين'
    });
    
    if (!company) {
      console.log('❌ Company not found');
      process.exit(1);
    }
    
    console.log(`Found company: ${company.nameAr} (${company.name})\n`);
    
    // Simulate the API logic
    const insuranceCompanyData = company;
    const insuranceCompanyId = company._id;
    
    // Build full company name exactly as API does
    const fullCompanyName = insuranceCompanyData.nameAr && insuranceCompanyData.name 
      ? `${insuranceCompanyData.nameAr} - ${insuranceCompanyData.name}`
      : (insuranceCompanyData.nameAr || insuranceCompanyData.name);
    
    console.log('Full Company Name to be saved:');
    console.log(`  "${fullCompanyName}"\n`);
    
    // Create a test claim (same logic as API)
    const testClaim = new InsuranceClaim({
      pharmacyId: pharmacy._id,
      pharmacyName: pharmacy.fullName,
      insuranceCompanyId,
      insuranceCompany: fullCompanyName,
      claimMonth: '12',
      claimYear: '2024',
      claimsCount: 5,
      claimsValue: 1500,
      notes: 'Test claim for verification',
      status: 'draft',
      servicePaymentStatus: 'unpaid',
      statusHistory: [{ 
        status: 'draft', 
        changedBy: pharmacy.fullName, 
        reason: 'تم إنشاء مسودة المطالبة' 
      }]
    });
    
    await testClaim.save();
    console.log(`✅ Created new test claim with ID: ${testClaim._id}\n`);
    
    // Verify it was saved correctly
    const savedClaim = await InsuranceClaim.findById(testClaim._id).populate('insuranceCompanyId');
    
    console.log('Saved Claim Details:');
    console.log(`  ID: ${savedClaim._id}`);
    console.log(`  Status: ${savedClaim.status}`);
    console.log(`  Stored Name: "${savedClaim.insuranceCompany}"`);
    console.log(`  Company ID: ${savedClaim.insuranceCompanyId?._id || savedClaim.insuranceCompanyId}`);
    console.log(`  Month/Year: ${savedClaim.claimMonth}/${savedClaim.claimYear}`);
    
    // Verify format is correct
    const hasCorrectFormat = savedClaim.insuranceCompany.includes(' - ');
    console.log(`\n✅ Correct format (Arabic - English): ${hasCorrectFormat ? 'YES ✓' : 'NO ✗'}`);
    
    // Check if it aggregates with existing claims
    const claimsForCompany = await InsuranceClaim.find({ 
      insuranceCompanyId: company._id,
      insuranceCompany: fullCompanyName
    });
    
    console.log(`\n📊 Total claims for this company with this name: ${claimsForCompany.length}`);
    console.log('   (Should be 4 now: 3 old + 1 new test claim)');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testCreate();
