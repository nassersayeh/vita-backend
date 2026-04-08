const express = require('express');
const router = express.Router();
const Drug = require('../models/Drug');

// Arabic to Latin transliteration — produces a regex pattern
// that accounts for common ambiguities (ب→b/p, ف→f/v/ph, etc.)
const arabicToLatinRegex = {
  'ا': 'a?', 'أ': 'a?', 'إ': '[ei]?', 'آ': 'a',
  'ب': '[bp]', 'ت': 't', 'ث': 'th',
  'ج': '[jg]', 'ح': 'h', 'خ': 'kh',
  'د': 'd', 'ذ': 'th', 'ر': 'r', 'ز': 'z',
  'س': '[scx]', 'ش': 'sh', 'ص': 's', 'ض': 'd',
  'ط': 't', 'ظ': 'z', 'ع': 'a?', 'غ': 'g[h]?',
  'ف': '[fvp]h?', 'ق': '[qk]', 'ك': '[ckx]', 'ل': 'l',
  'م': 'm', 'ن': 'n', 'ه': 'h?', 'و': '[ouew]?',
  'ي': '[iey]', 'ى': 'a', 'ئ': '[ei]', 'ؤ': '[ou]',
  'ة': '[aeh]?', 'ء': 'a?',
  'َ': 'a?', 'ُ': 'u?', 'ِ': 'i?', 'ّ': '', 'ْ': '',
};

function transliterateArabicToRegex(text) {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (arabicToLatinRegex[ch] !== undefined) {
      result += arabicToLatinRegex[ch];
      // Add optional vowel between consonant clusters for fuzzy matching
      result += '[aeiou]?';
    } else if (/\s/.test(ch)) {
      result += '\\s*';
    } else {
      // Keep non-Arabic chars as-is (escape if needed)
      result += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return result;
}

function hasArabic(text) {
  return /[\u0600-\u06FF]/.test(text);
}

// Get all drugs with search and filtering
router.get('/', async (req, res) => {
  try {
    const { search, category, page = 1, limit = 50 } = req.query;
    
    let filter = { isActive: true };
    
    if (search) {
      const searchConditions = [
        { name: { $regex: search, $options: 'i' } },
        { genericName: { $regex: search, $options: 'i' } },
        { activeIngredients: { $in: [new RegExp(search, 'i')] } }
      ];
      // If Arabic input, also search transliterated version
      if (hasArabic(search)) {
        const latinPattern = transliterateArabicToRegex(search);
        if (latinPattern && latinPattern.length >= 2) {
          searchConditions.push({ name: { $regex: latinPattern, $options: 'i' } });
          searchConditions.push({ genericName: { $regex: latinPattern, $options: 'i' } });
        }
      }
      filter.$or = searchConditions;
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

// Popular drugs endpoint - returns drugs for browsing (paginated)
router.get('/popular', async (req, res) => {
  try {
    const { page = 1, limit = 40 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const drugs = await Drug.find({ isActive: true, unitSellingPrice: { $gt: 0 } })
      .select('name genericName unitSellingPrice barcode')
      .sort({ name: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Drug.countDocuments({ isActive: true, unitSellingPrice: { $gt: 0 } });

    res.json({
      drugs,
      total,
      totalPages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page)
    });
  } catch (error) {
    console.error('Popular drugs error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Quick search endpoint (supports Arabic & English)
router.get('/search/quick', async (req, res) => {
  try {
    const { q, limit = 20 } = req.query;
    
    if (!q || q.trim().length < 2) {
      return res.json({ drugs: [] });
    }

    const searchTerm = q.trim();
    
    // Build search conditions
    const searchConditions = [
      { name: { $regex: searchTerm, $options: 'i' } },
      { genericName: { $regex: searchTerm, $options: 'i' } },
      { activeIngredients: { $in: [new RegExp(searchTerm, 'i')] } }
    ];

    // If input has Arabic characters, also search transliterated version
    if (hasArabic(searchTerm)) {
      const latinPattern = transliterateArabicToRegex(searchTerm);
      if (latinPattern && latinPattern.length >= 2) {
        searchConditions.push({ name: { $regex: latinPattern, $options: 'i' } });
        searchConditions.push({ genericName: { $regex: latinPattern, $options: 'i' } });
      }
    }

    const drugs = await Drug.find({
      isActive: true,
      $or: searchConditions
    })
    .select('name genericName category manufacturer unitSellingPrice barcode')
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

// Get drug by ID (MUST be after all specific routes to avoid catching /popular, /search/quick etc.)
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

module.exports = router;
