const http = require('http');

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

function makeRequest(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    if (data) {
      const jsonData = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(jsonData);
    }

    const req = http.request(options, (res) => {
      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

async function addTestData() {
  console.log('🔄 بدء إضافة بيانات الاختبار...\n');

  try {
    // 1. البحث عن المريض
    console.log('🔍 البحث عن المريض (nassersayeh)...');
    let response = await makeRequest('GET', '/api/users?search=nassersayeh');
    
    if (response.status !== 200) {
      console.log('❌ خطأ في البحث عن المريض');
      console.log(response);
      process.exit(1);
    }

    const users = response.data.data || response.data.users || response.data || [];
    const patient = Array.isArray(users) ? users.find(u => u.fullName === 'nassersayeh' || u.mobileNumber === 'nassersayeh') : users;

    if (!patient) {
      console.log('❌ لم يتم العثور على المريض');
      console.log('البيانات المرجعة:', response.data);
      process.exit(1);
    }

    const patientId = patient._id;
    console.log(`✅ تم العثور على المريض: ${patient.fullName} (${patientId})\n`);

    // 2. البحث عن الدكتور
    console.log('🔍 البحث عن الدكتور (0599123461)...');
    response = await makeRequest('GET', '/api/users?search=0599123461');

    if (response.status !== 200) {
      console.log('❌ خطأ في البحث عن الدكتور');
      process.exit(1);
    }

    const doctors = response.data.data || response.data.users || response.data || [];
    const doctor = Array.isArray(doctors) ? doctors.find(d => d.mobileNumber === '0599123461' && d.role === 'Doctor') : doctors;

    if (!doctor) {
      console.log('❌ لم يتم العثور على الدكتور');
      console.log('البيانات المرجعة:', response.data);
      process.exit(1);
    }

    const doctorId = doctor._id;
    console.log(`✅ تم العثور على الدكتور: ${doctor.fullName} (${doctorId})\n`);

    // 3. إضافة المريض إلى قائمة مرضى الدكتور
    console.log('➕ إضافة المريض إلى قائمة الدكتور...');
    response = await makeRequest('PUT', `/api/doctors/${doctorId}/add-patient`, { patientId });
    
    if (response.status === 200 || response.status === 201) {
      console.log('✅ تم إضافة المريض\n');
    } else {
      console.log('⚠️  رد الخادم:', response.status);
      console.log(response.data);
    }

    console.log('✅ تم إنجاز جميع العمليات بنجاح!');
    console.log(`المريض: ${patientId}`);
    console.log(`الدكتور: ${doctorId}`);
    
    process.exit(0);

  } catch (error) {
    console.error('❌ حدث خطأ:', error.message);
    process.exit(1);
  }
}

addTestData();
