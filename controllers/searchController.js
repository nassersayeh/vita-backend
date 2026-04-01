// controllers/searchController.js
const User = require('../models/User');
const Drug = require('../models/Drug');
const MedicalTest = require('../models/MedicalTest');
const Product = require('../models/Product');

exports.searchUsers = async (req, res) => {
  try {
    const { role, city, country, keyword } = req.query;

    if (!role) {
      return res.status(400).json({ message: "Missing required query parameter: role." });
    }

    // Determine target roles based on current user's role
    let targetRoles = [];
    if (role === "User") {
      targetRoles = ["Doctor", "Pharmacy"]; // Users search for doctors and pharmacies
    } else if (role === "Doctor") {
      targetRoles = ["User","Pharmacy"]; // Doctors search for patients
    } else if (role === "Pharmacy") {
      targetRoles = ["User","Doctor"]; // Pharmacies search for patients/users with orders
    } else if (role === "Admin") {
      targetRoles = ["Doctor", "Pharmacy", "User"]; // Admins see all roles
    } else {
      return res.status(400).json({ message: "Invalid role provided." });
    }

    // Build the search query
    const searchQuery = {
      role: { $in: targetRoles }
    };

    // Add geographic filters if provided and not empty
    if (city && city.trim() !== "") {
      searchQuery.city = { $regex: city.trim(), $options: "i" };
    }
    if (country && country.trim() !== "") {
      searchQuery.country = { $regex: country.trim(), $options: "i" };
    }

    // Add keyword search with role-specific fields
    if (keyword && keyword.trim() !== "") {
      searchQuery.$or = [
        { fullName: { $regex: keyword.trim(), $options: "i" } }
      ];
      if (targetRoles.includes("Doctor")) {
        searchQuery.$or.push({ specialty: { $regex: keyword.trim(), $options: "i" } });
      }
      if (targetRoles.includes("Pharmacy")) {
        searchQuery.$or.push({ address: { $regex: keyword.trim(), $options: "i" } });
      }
    }

    // Use collation for Arabic locale
    const users = await User.find(searchQuery).collation({ locale: "ar", strength: 1 });

    res.json(users);
  } catch (error) {
    console.error("Error during search:", error);
    res.status(500).json({ message: "Server error during search." });
  }
};

// Comprehensive unified search across all categories
exports.unifiedSearch = async (req, res) => {
  try {
    const { query, category, city, limit = 20 } = req.query;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({ 
        success: false, 
        message: "Search query must be at least 2 characters." 
      });
    }

    const searchTerm = query.trim();
    const searchLimit = Math.min(parseInt(limit), 50);
    const results = {
      doctors: [],
      pharmacies: [],
      labs: [],
      hospitals: [],
      medications: [],
      tests: [],
    };

    // Build city filter if provided
    const cityFilter = city && city.trim() !== "" 
      ? { city: { $regex: city.trim(), $options: "i" } }
      : {};

    // Define which categories to search
    const categoriesToSearch = category && category !== 'all' 
      ? [category] 
      : ['doctors', 'pharmacies', 'labs', 'hospitals', 'medications', 'tests'];

    // Search Doctors
    if (categoriesToSearch.includes('doctors')) {
      const doctors = await User.find({
        role: 'Doctor',
        isActive: { $ne: false },
        $or: [
          { fullName: { $regex: searchTerm, $options: "i" } },
          { specialty: { $regex: searchTerm, $options: "i" } },
          { bio: { $regex: searchTerm, $options: "i" } },
        ],
        ...cityFilter
      })
      .select('fullName specialty profileImage city address rating workplaces consultationFee')
      .limit(searchLimit)
      .lean();

      results.doctors = doctors.map(doc => ({
        id: doc._id,
        type: 'doctor',
        name: doc.fullName,
        subtitle: doc.specialty || 'General Physician',
        image: doc.profileImage,
        city: doc.city,
        address: doc.address,
        rating: doc.rating || 4.5,
        fee: doc.consultationFee,
        workplaces: doc.workplaces?.length || 0,
      }));
    }

    // Search Pharmacies
    if (categoriesToSearch.includes('pharmacies')) {
      const pharmacies = await User.find({
        role: 'Pharmacy',
        isActive: { $ne: false },
        $or: [
          { fullName: { $regex: searchTerm, $options: "i" } },
          { address: { $regex: searchTerm, $options: "i" } },
        ],
        ...cityFilter
      })
      .select('fullName profileImage city address mobileNumber workingSchedule')
      .limit(searchLimit)
      .lean();

      results.pharmacies = pharmacies.map(pharm => ({
        id: pharm._id,
        type: 'pharmacy',
        name: pharm.fullName,
        subtitle: pharm.address || 'Pharmacy',
        image: pharm.profileImage,
        city: pharm.city,
        address: pharm.address,
        phone: pharm.mobileNumber,
        isOpen: checkIfOpen(pharm.workingSchedule),
      }));
    }

    // Search Labs
    if (categoriesToSearch.includes('labs')) {
      const labs = await User.find({
        role: 'Lab',
        isActive: { $ne: false },
        $or: [
          { fullName: { $regex: searchTerm, $options: "i" } },
          { address: { $regex: searchTerm, $options: "i" } },
        ],
        ...cityFilter
      })
      .select('fullName profileImage city address mobileNumber')
      .limit(searchLimit)
      .lean();

      results.labs = labs.map(lab => ({
        id: lab._id,
        type: 'lab',
        name: lab.fullName,
        subtitle: lab.address || 'Medical Laboratory',
        image: lab.profileImage,
        city: lab.city,
        address: lab.address,
        phone: lab.mobileNumber,
      }));
    }

    // Search Hospitals/Institutions
    if (categoriesToSearch.includes('hospitals')) {
      const hospitals = await User.find({
        role: { $in: ['Hospital', 'Institution'] },
        isActive: { $ne: false },
        $or: [
          { fullName: { $regex: searchTerm, $options: "i" } },
          { address: { $regex: searchTerm, $options: "i" } },
        ],
        ...cityFilter
      })
      .select('fullName profileImage city address mobileNumber')
      .limit(searchLimit)
      .lean();

      results.hospitals = hospitals.map(hosp => ({
        id: hosp._id,
        type: 'hospital',
        name: hosp.fullName,
        subtitle: hosp.address || 'Medical Institution',
        image: hosp.profileImage,
        city: hosp.city,
        address: hosp.address,
        phone: hosp.mobileNumber,
      }));
    }

    // Search Medications (Drugs)
    if (categoriesToSearch.includes('medications')) {
      const medications = await Drug.find({
        isActive: { $ne: false },
        $or: [
          { name: { $regex: searchTerm, $options: "i" } },
          { genericName: { $regex: searchTerm, $options: "i" } },
          { category: { $regex: searchTerm, $options: "i" } },
          { manufacturer: { $regex: searchTerm, $options: "i" } },
        ]
      })
      .select('name genericName category dosageForm strength manufacturer unitSellingPrice')
      .limit(searchLimit)
      .lean();

      results.medications = medications.map(med => ({
        id: med._id,
        type: 'medication',
        name: med.name,
        subtitle: med.genericName || med.category || 'Medication',
        category: med.category,
        dosageForm: med.dosageForm,
        strength: med.strength,
        manufacturer: med.manufacturer,
        price: med.unitSellingPrice,
      }));
    }

    // Search Medical Tests
    if (categoriesToSearch.includes('tests')) {
      const tests = await MedicalTest.find({
        isActive: { $ne: false },
        $or: [
          { name: { $regex: searchTerm, $options: "i" } },
          { category: { $regex: searchTerm, $options: "i" } },
          { description: { $regex: searchTerm, $options: "i" } },
        ]
      })
      .select('name type category description preparationInstructions estimatedDuration')
      .limit(searchLimit)
      .lean();

      results.tests = tests.map(test => ({
        id: test._id,
        type: 'test',
        name: test.name,
        subtitle: test.category || test.type,
        testType: test.type,
        category: test.category,
        description: test.description,
        preparation: test.preparationInstructions,
        duration: test.estimatedDuration,
      }));
    }

    // Calculate total count
    const totalCount = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);

    // Combine all results into a flat array if searching all categories
    let allResults = [];
    if (!category || category === 'all') {
      allResults = [
        ...results.doctors,
        ...results.pharmacies,
        ...results.labs,
        ...results.hospitals,
        ...results.medications,
        ...results.tests,
      ];
    }

    res.json({
      success: true,
      query: searchTerm,
      category: category || 'all',
      totalCount,
      results: category && category !== 'all' ? results[category] || [] : results,
      allResults: allResults.slice(0, searchLimit),
    });

  } catch (error) {
    console.error("Error during unified search:", error);
    res.status(500).json({ 
      success: false, 
      message: "Server error during search.",
      error: error.message 
    });
  }
};

// Search suggestions/autocomplete
exports.searchSuggestions = async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.trim().length < 2) {
      return res.json({ success: true, suggestions: [] });
    }

    const searchTerm = query.trim();
    const suggestions = [];

    // Get doctor specialties
    const specialties = await User.distinct('specialty', {
      role: 'Doctor',
      specialty: { $regex: searchTerm, $options: "i" },
      isActive: { $ne: false }
    });
    specialties.slice(0, 5).forEach(spec => {
      if (spec) suggestions.push({ text: spec, type: 'specialty' });
    });

    // Get doctor names
    const doctors = await User.find({
      role: 'Doctor',
      fullName: { $regex: searchTerm, $options: "i" },
      isActive: { $ne: false }
    })
    .select('fullName specialty')
    .limit(5)
    .lean();
    doctors.forEach(doc => {
      suggestions.push({ text: doc.fullName, type: 'doctor', subtitle: doc.specialty });
    });

    // Get medication names
    const meds = await Drug.find({
      name: { $regex: searchTerm, $options: "i" },
      isActive: { $ne: false }
    })
    .select('name category')
    .limit(5)
    .lean();
    meds.forEach(med => {
      suggestions.push({ text: med.name, type: 'medication', subtitle: med.category });
    });

    // Get test names
    const tests = await MedicalTest.find({
      name: { $regex: searchTerm, $options: "i" },
      isActive: { $ne: false }
    })
    .select('name category')
    .limit(5)
    .lean();
    tests.forEach(test => {
      suggestions.push({ text: test.name, type: 'test', subtitle: test.category });
    });

    res.json({
      success: true,
      suggestions: suggestions.slice(0, 15),
    });

  } catch (error) {
    console.error("Error fetching suggestions:", error);
    res.status(500).json({ 
      success: false, 
      message: "Server error fetching suggestions." 
    });
  }
};

// Get popular/trending searches
exports.getPopularSearches = async (req, res) => {
  try {
    // Return static popular searches for now
    // In production, this could be based on actual search analytics
    const popular = [
      { text: 'General Physician', textAr: 'طبيب عام', type: 'doctors' },
      { text: 'Dentist', textAr: 'طبيب أسنان', type: 'doctors' },
      { text: 'Cardiologist', textAr: 'طبيب قلب', type: 'doctors' },
      { text: 'Pharmacy Nearby', textAr: 'صيدلية قريبة', type: 'pharmacies' },
      { text: 'Blood Test', textAr: 'فحص دم', type: 'tests' },
      { text: 'X-Ray', textAr: 'أشعة سينية', type: 'tests' },
      { text: 'Panadol', textAr: 'بنادول', type: 'medications' },
      { text: 'Pediatrician', textAr: 'طبيب أطفال', type: 'doctors' },
    ];

    res.json({
      success: true,
      popular,
    });

  } catch (error) {
    console.error("Error fetching popular searches:", error);
    res.status(500).json({ 
      success: false, 
      message: "Server error fetching popular searches." 
    });
  }
};

// Helper function to check if a business is currently open
function checkIfOpen(workingSchedule) {
  if (!workingSchedule || workingSchedule.length === 0) return null;

  const now = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const currentDay = days[now.getDay()];
  const currentTime = now.getHours() * 60 + now.getMinutes();

  const todaySchedule = workingSchedule.find(s => 
    s.day.toLowerCase() === currentDay.toLowerCase()
  );

  if (!todaySchedule || !todaySchedule.timeSlots || todaySchedule.timeSlots.length === 0) {
    return false;
  }

  return todaySchedule.timeSlots.some(slot => {
    const [startH, startM] = slot.start.split(':').map(Number);
    const [endH, endM] = slot.end.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;
    return currentTime >= startMinutes && currentTime <= endMinutes;
  });
}