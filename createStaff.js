const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

async function createStaff() {
  await mongoose.connect('mongodb+srv://vita:pop1990@cluster0.nj5pcz0.mongodb.net');
  console.log('Connected to MongoDB');
  
  const User = require('./models/User');
  const Clinic = require('./models/Clinic');
  
  // Find clinic
  const clinicUser = await User.findOne({ mobileNumber: '059000000', role: 'Clinic' });
  if (!clinicUser) { console.error('Clinic user not found!'); process.exit(1); }
  
  const clinic = await Clinic.findOne({ ownerId: clinicUser._id });
  if (!clinic) { console.error('Clinic document not found!'); process.exit(1); }
  
  console.log('Found clinic:', clinic.name, '- ID:', clinic._id);
  
  const password = await bcrypt.hash('123456789', 10);
  
  const staff = [
    // Nurses
    { fullName: 'نور قنيري', mobile: '0593274299', role: 'Nurse', specialty: 'تمريض' },
    { fullName: 'شذى حجاب', mobile: '0569156627', role: 'Nurse', specialty: 'تمريض' },
    
    // LabTech
    { fullName: 'يافا حجاب', mobile: '0594642997', role: 'LabTech', specialty: 'طب مخبري' },
    { fullName: 'لمى سروجي', mobile: '0598413681', role: 'LabTech', specialty: 'طب مخبري' },
    
    // Accountant
    { fullName: 'ريان صايغ', mobile: '0594540647', role: 'Accountant', specialty: 'محاسبة وتسجيل' },
    { fullName: 'طه التك', mobile: '0568870030', role: 'Accountant', specialty: 'محاسبة وتسجيل' },
    
    // Dentists
    { fullName: 'احمد حنون', mobile: '0569826707', role: 'Doctor', specialty: 'طب أسنان' },
    { fullName: 'علاء ابو كشك', mobile: '0594417681', role: 'Doctor', specialty: 'طب أسنان' },
    { fullName: 'مجد اسعد', mobile: '0598371022', role: 'Doctor', specialty: 'طب أسنان' },
    
    // General Doctors
    { fullName: 'احمد عدوي', mobile: '0598491649', role: 'Doctor', specialty: 'طب عام' },
    { fullName: 'محمود ابو رجب', mobile: '0594929543', role: 'Doctor', specialty: 'طب عام' },
    { fullName: 'عمر ابو كشك', mobile: '0599175523', role: 'Doctor', specialty: 'طب عام' },
  ];
  
  let counter = 1;
  for (const s of staff) {
    try {
      const user = new User({
        fullName: s.fullName,
        mobileNumber: s.mobile,
        password: password,
        email: 'staff' + counter + '@alshaab.clinic',
        role: s.role,
        specialty: s.specialty || '',
        country: 'Palestine',
        city: 'Hebron',
        idNumber: 'SHAAB' + String(counter).padStart(3, '0'),
        address: 'الخليل - فلسطين',
        isPhoneVerified: true,
        activationStatus: 'active',
        managedByClinic: s.role === 'Doctor' ? true : false,
        clinicId: clinic._id,
        workplaces: s.role === 'Doctor' ? [{
          name: 'مركز الشعب الطبي',
          address: 'الخليل - فلسطين',
          isActive: true
        }] : undefined,
      });
      await user.save();
      
      // Add to clinic
      if (s.role === 'Doctor') {
        clinic.doctors.push({ doctorId: user._id, status: 'active', notes: s.specialty });
      } else {
        clinic.staff.push({ userId: user._id, role: s.role, status: 'active', notes: s.specialty });
      }
      
      console.log('✅ ' + s.role + ': ' + s.fullName + ' (' + s.mobile + ')');
      counter++;
    } catch (err) {
      console.error('❌ Failed ' + s.fullName + ':', err.message);
    }
  }
  
  // Save clinic with all staff/doctors
  await clinic.save();
  console.log('\n✅ All staff linked to مركز الشعب الطبي');
  console.log('Doctors in clinic:', clinic.doctors.length);
  console.log('Staff in clinic:', clinic.staff.length);
  
  process.exit(0);
}

createStaff().catch(err => { console.error('Error:', err); process.exit(1); });
