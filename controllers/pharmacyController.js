const User = require('../models/User');

exports.getPharmacyById = async (req, res) => {
  try {
    // Only return a user with role "pharmacy"
    const id =req.params.id
    const pharmacy = await User.findOne({ _id: id, role: 'Pharmacy' });
    if (!pharmacy) {
      return res.status(404).json({ message: 'Pharmacy not found' });
    }
    res.json({ pharmacy });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get pharmacy customers
exports.getCustomersForPharmacy = async (req, res) => {
  try {
    const pharmacyId = req.params.id;
    const { search, limit = 50 } = req.query;
    const PharmacyCustomer = require('../models/PharmacyCustomer');

    let query = { pharmacyId };

    // Add search functionality
    if (search && search.trim()) {
      query.name = { $regex: search.trim(), $options: 'i' };
    }

    const customers = await PharmacyCustomer.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json({ customers });
  } catch (error) {
    console.error('Error fetching pharmacy customers:', error);
    res.status(500).json({ message: 'Error fetching pharmacy customers' });
  }
};

// Create or link a customer to a pharmacy
exports.createCustomerForPharmacy = async (req, res) => {
  try {
    const pharmacyId = req.params.id;
    const { name, phone } = req.body;
    if (!phone || !name) return res.status(400).json({ message: 'name and phone are required' });

    const PharmacyCustomer = require('../models/PharmacyCustomer');
    const User = require('../models/User');

    // Check if user exists
    let user = await User.findOne({ mobileNumber: phone });

    // If not, create a lightweight guest user without full validation
    if (!user) {
      const bcrypt = require('bcryptjs');
      const tempPass = Math.random().toString(36).slice(-8) || 'guestpass';
      const hashed = await bcrypt.hash(tempPass, 10);
      user = new User({
        fullName: name,
        mobileNumber: phone,
        password: hashed,
        country: 'N/A', city: 'N/A', idNumber: `guest-${Date.now()}`, address: 'N/A', role: 'User', isPhoneVerified: false
      });
      await user.save({ validateBeforeSave: false });
    }

    // If a PharmacyCustomer already exists with this phone, return it
    let existing = await PharmacyCustomer.findOne({ pharmacyId, phone });
    if (existing) return res.status(200).json({ customer: existing, message: 'Customer already saved' });

    const customer = new PharmacyCustomer({ pharmacyId, userId: user._id, name, phone });
    await customer.save();

    res.status(201).json({ customer });
  } catch (error) {
    console.error('Error creating pharmacy customer:', error);
    res.status(500).json({ message: 'Error creating pharmacy customer' });
  }
};

// Update pharmacy customer
exports.updateCustomerForPharmacy = async (req, res) => {
  try {
    const pharmacyId = req.params.id;
    const customerId = req.params.customerId;
    const { name, phone, notes } = req.body;

    const PharmacyCustomer = require('../models/PharmacyCustomer');
    const customer = await PharmacyCustomer.findOneAndUpdate(
      { _id: customerId, pharmacyId },
      { name, phone, notes },
      { new: true }
    );

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    res.json({ customer });
  } catch (error) {
    console.error('Error updating pharmacy customer:', error);
    res.status(500).json({ message: 'Error updating pharmacy customer' });
  }
};

// Delete pharmacy customer
exports.deleteCustomerForPharmacy = async (req, res) => {
  try {
    const pharmacyId = req.params.id;
    const customerId = req.params.customerId;

    const PharmacyCustomer = require('../models/PharmacyCustomer');
    const customer = await PharmacyCustomer.findOneAndDelete({ _id: customerId, pharmacyId });

    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    res.json({ message: 'Customer deleted successfully' });
  } catch (error) {
    console.error('Error deleting pharmacy customer:', error);
    res.status(500).json({ message: 'Error deleting pharmacy customer' });
  }
};
// New controller to get all pharmacies
exports.getAllPharmacies = async (req, res) => {
  try {
    // Retrieve all users with role 'Pharmacy'
    const pharmacies = await User.find({ role: 'Pharmacy' });
    console.log(pharmacies)
    res.json(pharmacies);
  } catch (error) {
    console.error('Error fetching pharmacies:', error);
    res.status(500).json({ message: 'Error fetching pharmacies' });
  }
};

exports.getPharmaciesByCity = async (req, res) => {
  try {
    const city = req.params.city;

    // البحث عن المستخدمين الذين لديهم دور "Pharmacy" ويعملون في المدينة المحددة
    const pharmacies = await User.find({
      role: 'Pharmacy',
      city: city
    }).select('fullName address mobileNumber');

    if (!pharmacies.length) {
      return res.status(404).json({ message: 'لا توجد صيدليات في هذه المدينة' });
    }

    res.status(200).json(pharmacies);
  } catch (error) {
    console.error('Error fetching pharmacies:', error);
    res.status(500).json({ message: 'خطأ في الخادم أثناء جلب الصيدليات' });
  }
};

// Get insurance companies for a pharmacy
exports.getInsuranceCompaniesForPharmacy = async (req, res) => {
  try {
    const pharmacyId = req.params.id;
    const pharmacy = await User.findById(pharmacyId);
    
    if (!pharmacy || pharmacy.role !== 'Pharmacy') {
      return res.status(404).json({ message: 'Pharmacy not found' });
    }

    res.json({ insuranceCompanies: pharmacy.insuranceCompanies || [] });
  } catch (error) {
    console.error('Error fetching insurance companies:', error);
    res.status(500).json({ message: 'Error fetching insurance companies' });
  }
};

// Add insurance company for a pharmacy
exports.addInsuranceCompanyForPharmacy = async (req, res) => {
  try {
    const pharmacyId = req.params.id;
    const { name } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Insurance company name is required' });
    }

    const pharmacy = await User.findById(pharmacyId);
    
    if (!pharmacy || pharmacy.role !== 'Pharmacy') {
      return res.status(404).json({ message: 'Pharmacy not found' });
    }

    if (!pharmacy.insuranceCompanies) {
      pharmacy.insuranceCompanies = [];
    }

    if (!pharmacy.insuranceCompanies.includes(name.trim())) {
      pharmacy.insuranceCompanies.push(name.trim());
      await pharmacy.save();
    }

    res.json({ 
      message: 'Insurance company added successfully',
      insuranceCompanies: pharmacy.insuranceCompanies 
    });
  } catch (error) {
    console.error('Error adding insurance company:', error);
    res.status(500).json({ message: 'Error adding insurance company' });
  }
};

// Delete insurance company for a pharmacy
exports.deleteInsuranceCompanyForPharmacy = async (req, res) => {
  try {
    const pharmacyId = req.params.id;
    const companyName = decodeURIComponent(req.params.companyName);
    
    const pharmacy = await User.findById(pharmacyId);
    
    if (!pharmacy || pharmacy.role !== 'Pharmacy') {
      return res.status(404).json({ message: 'Pharmacy not found' });
    }

    if (pharmacy.insuranceCompanies) {
      pharmacy.insuranceCompanies = pharmacy.insuranceCompanies.filter(company => company !== companyName);
      await pharmacy.save();
    }

    res.json({ 
      message: 'Insurance company removed successfully',
      insuranceCompanies: pharmacy.insuranceCompanies 
    });
  } catch (error) {
    console.error('Error deleting insurance company:', error);
    res.status(500).json({ message: 'Error deleting insurance company' });
  }
};