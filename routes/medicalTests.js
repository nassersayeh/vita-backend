const express = require('express');
const router = express.Router();
const MedicalTest = require('../models/MedicalTest');

// Get all medical tests with search and filtering
router.get('/', async (req, res) => {
  try {
    const { search, type, category, page = 1, limit = 50 } = req.query;
    
    let filter = { isActive: true };
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (type) {
      filter.type = type;
    }
    
    if (category) {
      filter.category = category;
    }

    const tests = await MedicalTest.find(filter)
      .sort({ name: 1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await MedicalTest.countDocuments(filter);

    res.json({
      tests,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total
    });
  } catch (error) {
    console.error('Get medical tests error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get test by ID
router.get('/:testId', async (req, res) => {
  try {
    const test = await MedicalTest.findById(req.params.testId);
    if (!test) {
      return res.status(404).json({ message: 'Medical test not found' });
    }
    res.json(test);
  } catch (error) {
    console.error('Get medical test error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Add new medical test (admin/lab)
router.post('/', async (req, res) => {
  try {
    const {
      name,
      type,
      category,
      description,
      normalRange,
      unit,
      preparationInstructions,
      estimatedDuration
    } = req.body;

    if (!name || !type || !category) {
      return res.status(400).json({ message: 'Name, type, and category are required' });
    }

    // Check if test already exists
    const existingTest = await MedicalTest.findOne({ 
      name: { $regex: new RegExp('^' + name + '$', 'i') } 
    });
    if (existingTest) {
      return res.status(400).json({ message: 'Medical test with this name already exists' });
    }

    const test = new MedicalTest({
      name,
      type,
      category,
      description,
      normalRange,
      unit,
      preparationInstructions,
      estimatedDuration
    });

    await test.save();
    res.status(201).json(test);
  } catch (error) {
    console.error('Add medical test error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update medical test
router.put('/:testId', async (req, res) => {
  try {
    const test = await MedicalTest.findByIdAndUpdate(
      req.params.testId,
      { $set: req.body },
      { new: true }
    );

    if (!test) {
      return res.status(404).json({ message: 'Medical test not found' });
    }

    res.json(test);
  } catch (error) {
    console.error('Update medical test error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get test types
router.get('/types/list', async (req, res) => {
  try {
    const types = await MedicalTest.distinct('type', { isActive: true });
    res.json(types.sort());
  } catch (error) {
    console.error('Get test types error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get test categories by type
router.get('/categories/:type', async (req, res) => {
  try {
    const categories = await MedicalTest.distinct('category', { 
      type: req.params.type, 
      isActive: true 
    });
    res.json(categories.sort());
  } catch (error) {
    console.error('Get test categories error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
