const mongoose = require('mongoose');
require('./models/User');
const User = mongoose.model('User');

const dentalDoctors = [
  {
    fullName: 'د. أحمد محمود',
    mobileNumber: '+962791000001',
    password: '$2b$10$hashedpassword1',
    role: 'Doctor',
    specialty: 'طب الأسنان',
    city: 'عمان',
    country: 'الأردن',
    address: 'الدوار السابع، عمان',
    idNumber: 'DENT001',
    yearsOfExperience: 8,
    consultationFee: 25,
    rating: 4.5,
    ratingsCount: 120,
    bio: 'طبيب أسنان متخصص في جراحة الفم والأسنان وتجميل الأسنان',
    activationStatus: 'active',
    isPaid: true
  },
  {
    fullName: 'د. فاطمة العلي',
    mobileNumber: '+962791000002', 
    password: '$2b$10$hashedpassword2',
    role: 'Doctor',
    specialty: 'طب الأسنان',
    city: 'إربد',
    country: 'الأردن',
    address: 'شارع الحصن، إربد',
    idNumber: 'DENT002',
    yearsOfExperience: 12,
    consultationFee: 30,
    rating: 4.8,
    ratingsCount: 89,
    bio: 'دكتورة أسنان متخصصة في طب أسنان الأطفال وتقويم الأسنان',
    activationStatus: 'active',
    isPaid: true
  },
  {
    fullName: 'د. محمد الخطيب',
    mobileNumber: '+962791000003',
    password: '$2b$10$hashedpassword3', 
    role: 'Doctor',
    specialty: 'طب الأسنان',
    city: 'الزرقاء',
    country: 'الأردن',
    address: 'وسط البلد، الزرقاء',
    idNumber: 'DENT003',
    yearsOfExperience: 15,
    consultationFee: 35,
    rating: 4.7,
    ratingsCount: 156,
    bio: 'طبيب أسنان خبير في زراعة الأسنان وجراحة اللثة',
    activationStatus: 'active',
    isPaid: true
  },
  {
    fullName: 'د. سارة الأحمد',
    mobileNumber: '+962791000004',
    password: '$2b$10$hashedpassword4',
    role: 'Doctor', 
    specialty: 'طب الأسنان',
    city: 'عمان',
    country: 'الأردن',
    address: 'الجبيهة، عمان',
    idNumber: 'DENT004',
    yearsOfExperience: 6,
    consultationFee: 22,
    rating: 4.3,
    ratingsCount: 75,
    bio: 'طبيبة أسنان تعمل في الحشوات التجميلية وتبييض الأسنان',
    activationStatus: 'active',
    isPaid: true
  }
];

mongoose.connect('mongodb://localhost:27018/vita')
  .then(async () => {
    console.log('Connected to MongoDB');
    
    // Create dental doctors
    for (const doctor of dentalDoctors) {
      try {
        await User.create(doctor);
        console.log(`✅ Created dental doctor: ${doctor.fullName} in ${doctor.city}`);
      } catch (error) {
        if (error.code === 11000) {
          console.log(`ℹ️  Dental doctor already exists: ${doctor.fullName}`);
        } else {
          console.error(`❌ Error creating ${doctor.fullName}:`, error.message);
        }
      }
    }
    
    // Verify creation
    const createdDentists = await User.find({ 
      role: 'Doctor', 
      specialty: /أسنان|dental/i 
    }).select('fullName specialty city rating');
    
    console.log('\n🦷 Dental doctors in database:');
    createdDentists.forEach(doc => {
      console.log(`- ${doc.fullName} | ${doc.specialty} | ${doc.city} | Rating: ${doc.rating}`);
    });
    
    process.exit(0);
  })
  .catch(err => {
    console.error('Database connection error:', err);
    process.exit(1);
  });