const express = require('express');
const router = express.Router();
const Drug = require('../models/Drug');

// Get all drugs with search and filtering
router.get('/', async (req, res) => {
  try {
    const { search, category, page = 1, limit = 50 } = req.query;
    
    let filter = { isActive: true };
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { genericName: { $regex: search, $options: 'i' } },
        { activeIngredients: { $in: [new RegExp(search, 'i')] } }
      ];
    }
    
    if (category) {
      filter.category = category;
    }

    const drugs = await Drug.find(filter)
      .sort({ name: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Drug.countDocuments(filter);

    res.json({
      drugs,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get drugs error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get drug by ID
router.get('/:drugId', async (req, res) => {
  try {
    const drug = await Drug.findById(req.params.drugId);
    if (!drug) {
      return res.status(404).json({ message: 'Drug not found' });
    }
    res.json(drug);
  } catch (error) {
    console.error('Get drug error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add new drug (admin/pharmacy)
router.post('/', async (req, res) => {
  try {
    const {
      name,
      genericName,
      description,
      category,
      manufacturer,
      dosageForm,
      strength,
      activeIngredients,
      contraindications,
      sideEffects,
      barcode
    } = req.body;

    if (!name || !category) {
      return res.status(400).json({ message: 'Name and category are required' });
    }

    // Check if drug already exists
    const existingDrug = await Drug.findOne({ name: { $regex: new RegExp('^' + name + '$', 'i') } });
    if (existingDrug) {
      return res.status(400).json({ message: 'Drug with this name already exists' });
    }

    const drug = new Drug({
      name,
      genericName,
      description,
      category,
      manufacturer,
      dosageForm,
      strength,
      activeIngredients: activeIngredients || [],
      contraindications: contraindications || [],
      sideEffects: sideEffects || [],
      barcode
    });

    await drug.save();
    res.status(201).json(drug);
  } catch (error) {
    console.error('Add drug error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update drug
router.put('/:drugId', async (req, res) => {
  try {
    const drug = await Drug.findByIdAndUpdate(
      req.params.drugId,
      { $set: req.body },
      { new: true }
    );

    if (!drug) {
      return res.status(404).json({ message: 'Drug not found' });
    }

    res.json(drug);
  } catch (error) {
    console.error('Update drug error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete drug
router.delete('/:drugId', async (req, res) => {
  try {
    const drug = await Drug.findByIdAndDelete(req.params.drugId);
    if (!drug) {
      return res.status(404).json({ message: 'Drug not found' });
    }
    res.json({ message: 'Deleted successfully' });
  } catch (error) {
    console.error('Delete drug error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get drug categories
router.get('/categories/list', async (req, res) => {
  try {
    const categories = await Drug.distinct('category', { isActive: true });
    res.json(categories.sort());
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Quick search endpoint for prescriptions (returns limited results)
router.get('/search/quick', async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.json({ drugs: [] });
    }

    const searchTerm = q.trim();
    const drugs = await Drug.find({
      isActive: true,
      $or: [
        { name: { $regex: searchTerm, $options: 'i' } },
        { genericName: { $regex: searchTerm, $options: 'i' } },
        { activeIngredients: { $in: [new RegExp(searchTerm, 'i')] } }
      ]
    })
    .select('name genericName category manufacturer')
    .sort({ name: 1 })
    .limit(parseInt(limit));

    res.json({ drugs });
  } catch (error) {
    console.error('Quick search error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Search drugs by barcode
router.get('/barcode/:barcode', async (req, res) => {
  try {
    const drug = await Drug.findOne({ barcode: req.params.barcode, isActive: true });
    if (!drug) {
      return res.status(404).json({ message: 'Drug not found' });
    }
    res.json(drug);
  } catch (error) {
    console.error('Search by barcode error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
