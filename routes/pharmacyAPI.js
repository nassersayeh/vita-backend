const express = require('express');
const router = express.Router();
const User = require('../models/User');

// Get all pharmacies
router.get('/all', async (req, res) => {
  try {
    const pharmacies = await User.find({ 
      role: 'Pharmacy',
      activationStatus: 'active'
    }).select('-password -resetCode -resetCodeExpiration');
    
    res.status(200).json({
      success: true,
      data: pharmacies
    });
  } catch (error) {
    console.error('Error fetching pharmacies:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching pharmacies'
    });
  }
});

// Search pharmacies by location or name
router.get('/search', async (req, res) => {
  try {
    const { query, city, country, lat, lng, radius = 10 } = req.query;
    
    let searchCriteria = {
      role: 'Pharmacy',
      activationStatus: 'active'
    };
    
    // Add text search if query provided
    if (query) {
      searchCriteria.$or = [
        { fullName: { $regex: query, $options: 'i' } },
        { address: { $regex: query, $options: 'i' } }
      ];
    }
    
    // Add location filters
    if (city) {
      searchCriteria.city = { $regex: city, $options: 'i' };
    }
    
    if (country) {
      searchCriteria.country = { $regex: country, $options: 'i' };
    }
    
    const pharmacies = await User.find(searchCriteria)
      .select('-password -resetCode -resetCodeExpiration');
    
    // If coordinates provided, calculate distances (mock implementation)
    let pharmaciesWithDistance = pharmacies.map(pharmacy => {
      const pharmacyData = pharmacy.toObject();
      
      // Mock distance calculation - replace with actual geospatial calculation
      if (lat && lng) {
        pharmacyData.distance = Math.random() * 5; // Random distance 0-5 km
        pharmacyData.isOpen = Math.random() > 0.3; // 70% chance of being open
        pharmacyData.hasStock = Math.random() > 0.2; // 80% chance of having stock
        pharmacyData.estimatedWaitTime = pharmacyData.isOpen ? 
          `${Math.floor(Math.random() * 30) + 10}-${Math.floor(Math.random() * 30) + 20} mins` : 
          'Closed';
      }
      
      return pharmacyData;
    });
    
    // Sort by distance if coordinates provided
    if (lat && lng) {
      pharmaciesWithDistance.sort((a, b) => a.distance - b.distance);
    }
    
    res.status(200).json({
      success: true,
      data: pharmaciesWithDistance
    });
  } catch (error) {
    console.error('Error searching pharmacies:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while searching pharmacies'
    });
  }
});

// Get pharmacy details by ID
router.get('/:pharmacyId', async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    
    const pharmacy = await User.findOne({
      _id: pharmacyId,
      role: 'Pharmacy'
    }).select('-password -resetCode -resetCodeExpiration');
    
    if (!pharmacy) {
      return res.status(404).json({
        success: false,
        message: 'Pharmacy not found'
      });
    }
    
    // Add mock operational data
    const pharmacyData = pharmacy.toObject();
    pharmacyData.isOpen = Math.random() > 0.3;
    pharmacyData.openHours = '8:00 AM - 10:00 PM';
    pharmacyData.rating = (Math.random() * 2 + 3).toFixed(1); // 3.0 - 5.0 rating
    pharmacyData.services = ['Prescription Filling', 'Consultation', 'Home Delivery'];
    
    res.status(200).json({
      success: true,
      data: pharmacyData
    });
  } catch (error) {
    console.error('Error fetching pharmacy details:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching pharmacy details'
    });
  }
});

// Check medication availability at pharmacy
router.post('/:pharmacyId/check-availability', async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { medications } = req.body;
    
    const pharmacy = await User.findOne({
      _id: pharmacyId,
      role: 'Pharmacy',
      activationStatus: 'active'
    });
    
    if (!pharmacy) {
      return res.status(404).json({
        success: false,
        message: 'Pharmacy not found'
      });
    }
    
    // Mock availability check - replace with actual inventory system
    const availabilityResults = medications.map(med => ({
      medicationId: med.id || med._id,
      drugName: med.drugName || med.name,
      isAvailable: Math.random() > 0.2, // 80% availability
      quantity: Math.floor(Math.random() * 100) + 10,
      price: (Math.random() * 50 + 10).toFixed(2),
      estimatedWaitTime: Math.random() > 0.5 ? '15-30 mins' : 'Ready now'
    }));
    
    res.status(200).json({
      success: true,
      data: {
        pharmacyId,
        pharmacyName: pharmacy.fullName,
        medications: availabilityResults,
        totalAvailable: availabilityResults.filter(med => med.isAvailable).length,
        totalRequested: medications.length
      }
    });
  } catch (error) {
    console.error('Error checking medication availability:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while checking availability'
    });
  }
});

module.exports = router;
