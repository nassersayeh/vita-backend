
const User = require('../models/User');
const DoctorPatientRequest = require('../models/DoctorPatientRequest');

const PUBLIC_PROVIDER_ROLES = ['Doctor', 'Lab', 'Radiology', 'Institution', 'Hospital', 'Clinic'];
const NON_PRODUCTION_NAME = /(^|[\s._-])(test(?:ing)?|demo|sample|fake|تجريب(?:ي|ية)?|اختبار)([\s._-]|$)/i;
const publicProviderFilter = {
  role: { $in: PUBLIC_PROVIDER_ROLES },
  isPublic: { $ne: false },
  activationStatus: 'active',
};

const providerType = (role) => role === 'Doctor' ? 'doctor' : 'center';
const PROVIDER_LIST_CACHE_MS = 60 * 1000;
let providerListCache = { expiresAt: 0, data: null };

exports.getBookableProviders = async (req, res) => {
  try {
    if (providerListCache.data && providerListCache.expiresAt > Date.now()) {
      res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
      return res.json(providerListCache.data);
    }
    const providers = await User.find(publicProviderFilter)
      // Discovery cards intentionally receive only lightweight fields. Full
      // schedules, workplaces and biography are loaded on the profile screen.
      .select('fullName username email role specialty city profileImage')
      .sort({ role: 1, fullName: 1 })
      .maxTimeMS(1500)
      .lean();

    const cleanProviders = providers
      .filter((provider) => ![provider.fullName, provider.username, provider.email].some((value) => NON_PRODUCTION_NAME.test(value || '')))
      .map((provider) => ({
        _id: provider._id,
        fullName: provider.fullName,
        role: provider.role,
        specialty: provider.specialty,
        city: provider.city,
        profileImage: provider.profileImage,
        providerType: providerType(provider.role),
      }));
    const payload = { providers: cleanProviders };
    providerListCache = { data: payload, expiresAt: Date.now() + PROVIDER_LIST_CACHE_MS };
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
    res.json(payload);
  } catch (err) {
    console.error('getBookableProviders error:', err);
    res.status(500).json({ message: 'Server error fetching providers.' });
  }
};

// Helper function to check if a workplace is currently open
function checkWorkplaceAvailability(workplace) {
  if (!workplace.isActive || !workplace.schedule || workplace.schedule.length === 0) {
    return false;
  }

  const now = new Date();
  const currentDay = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now).toLowerCase(); // 'monday', 'tuesday', etc.
  const currentTime = now.getHours() * 100 + now.getMinutes(); // Convert to HHMM format for easy comparison

  // Find schedule for current day
  const todaySchedule = workplace.schedule.find(s => s.day.toLowerCase() === currentDay);
  
  if (!todaySchedule || !todaySchedule.timeSlots || todaySchedule.timeSlots.length === 0) {
    return false;
  }

  // Check if current time falls within any time slot
  return todaySchedule.timeSlots.some(slot => {
    const startTime = parseInt(slot.start.replace(':', ''));
    const endTime = parseInt(slot.end.replace(':', ''));
    return currentTime >= startTime && currentTime <= endTime;
  });
}

exports.getProviderDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const requestedType = String(req.query.type || '').toLowerCase();
    if (!id) return res.status(400).json({ success: false, message: 'Missing provider id' });

    // Find provider by id and role
    const roleFilter = requestedType === 'doctor'
      ? ['Doctor']
      : requestedType === 'center'
        ? PUBLIC_PROVIDER_ROLES.filter((role) => role !== 'Doctor')
        : PUBLIC_PROVIDER_ROLES;
    const provider = await User.findOne({ _id: id, role: { $in: roleFilter }, isPublic: { $ne: false }, activationStatus: 'active' });
    if (!provider) return res.status(404).json({ success: false, message: 'Provider not found' });

    // Build details object
    let details = {
      id: provider._id,
      name: provider.fullName,
      image: provider.profileImage,
      city: provider.city,
      address: provider.address,
      phone: provider.mobileNumber,
      type: providerType(provider.role),
      role: provider.role,
      bio: provider.bio || provider.generalDetails || '',
      specialty: provider.specialty || '',
      experience: provider.yearsOfExperience || provider.experience || 0,
      appointmentDurationOptions: provider.appointmentDurationOptions || [30, 60],
      allowPatientDurationChoice: provider.allowPatientDurationChoice === true,
      workingHours: provider.workingSchedule || [],
      location: provider.address,
    };

    // Doctor-specific
    if (provider.role === 'Doctor') {
      details.specialty = provider.specialty || '';
      details.experience = provider.yearsOfExperience || 0;
      details.rating = provider.rating || 0;
      details.ratingsCount = provider.ratingsCount || 0;
      
      // Process workplaces with availability status
      details.workplaces = (provider.workplaces || []).map(workplace => {
        const isOpen = checkWorkplaceAvailability(workplace);
        return {
          id: workplace._id,
          name: workplace.name,
          address: workplace.address,
          isActive: workplace.isActive,
          isOpen: isOpen,
          schedule: workplace.schedule || []
        };
      });
      
      // Check connection status
      const patientId = req.user?.id || req.query.patientId; // Get patient ID from auth or query
      if (patientId) {
        // Check if patient is already in doctor's patients list
        const isPatient = provider.patients?.some(patient => patient.toString() === patientId.toString());
        if (isPatient) {
          details.connectionStatus = 'connected';
        } else {
          // Check if there's a pending request
          const request = await DoctorPatientRequest.findOne({ 
            doctor: provider._id, 
            patient: patientId 
          });
          if (request) {
            details.connectionStatus = request.status; // 'pending', 'accepted', 'rejected'
          } else {
            details.connectionStatus = 'not_connected';
          }
        }
      } else {
        details.connectionStatus = 'not_connected';
      }
    }
    // Pharmacy-specific
    if (provider.role === 'Pharmacy') {
      // TODO: Calculate open/close status from workingHours
      details.isOpen = true;
      details.whatsapp = provider.mobileNumber;
      // Fetch inventory items for this pharmacy
      const PharmacyInventory = require('../models/PharmacyInventory');
      const inventoryItems = await PharmacyInventory.find({ pharmacyId: provider._id, isAvailable: true, isActive: true, quantity: { $gt: 0 } });
      details.inventory = inventoryItems.map(item => ({
        id: item.drugId,
        name: item.drugName,
        genericName: item.drugGenericName,
        price: item.price,
        quantity: item.quantity,
        currency: item.currency
      }));
    }
    // Lab/Hospital/Clinic
    if (provider.role !== 'Doctor') {
      details.workplaces = (provider.workplaces || []).map((workplace) => ({
        id: workplace._id,
        name: workplace.name,
        address: workplace.address,
        isActive: workplace.isActive,
        isOpen: checkWorkplaceAvailability(workplace),
        schedule: workplace.schedule || [],
      }));
      if (!details.workplaces.length && provider.workingSchedule?.length) {
        details.workplaces = [{
          name: provider.fullName,
          address: provider.address || provider.city || '',
          isActive: true,
          isOpen: true,
          schedule: provider.workingSchedule,
        }];
      }
    }

    res.json({ success: true, data: details });
  } catch (err) {
    console.error('getProviderDetails error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.connectProvider = async (req, res) => {
  try {
    const { id } = req.params; // provider ID
    const patientId = req.user?.id;
    
    if (!patientId) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // Check if provider exists and is a doctor
    const provider = await User.findOne({ _id: id, role: 'Doctor' });
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Doctor not found' });
    }

    // Check if patient is already connected
    if (provider.patients && provider.patients.includes(patientId)) {
      return res.status(400).json({ success: false, message: 'Already connected to this doctor' });
    }

    // Check if request already exists
    const existingRequest = await DoctorPatientRequest.findOne({ 
      doctor: id, 
      patient: patientId 
    });

    if (existingRequest) {
      if (existingRequest.status === 'pending') {
        return res.status(400).json({ success: false, message: 'Connection request already pending' });
      } else if (existingRequest.status === 'accepted') {
        return res.status(400).json({ success: false, message: 'Already connected to this doctor' });
      } else if (existingRequest.status === 'rejected') {
        // Allow resending if previously rejected
        existingRequest.status = 'pending';
        existingRequest.createdAt = new Date();
        existingRequest.respondedAt = undefined;
        await existingRequest.save();
        return res.json({ success: true, message: 'Connection request sent' });
      }
    }

    // Create new connection request
    const request = new DoctorPatientRequest({
      doctor: id,
      patient: patientId,
      status: 'pending'
    });

    await request.save();
    res.json({ success: true, message: 'Connection request sent' });
  } catch (err) {
    console.error('connectProvider error:', err);
    if (err.code === 11000) { // Duplicate key error
      return res.status(400).json({ success: false, message: 'Connection request already exists' });
    }
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
