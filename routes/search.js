const express = require('express');
const router = express.Router();
const searchController = require('../controllers/searchController');

// Legacy search - GET /api/search?role=...&city=...&country=...&keyword=...
router.get('/', searchController.searchUsers);

// Unified search - GET /api/search/unified?query=...&category=...&city=...&limit=...
router.get('/unified', searchController.unifiedSearch);

// Search suggestions/autocomplete - GET /api/search/suggestions?query=...
router.get('/suggestions', searchController.searchSuggestions);

// Get popular searches - GET /api/search/popular
router.get('/popular', searchController.getPopularSearches);

module.exports = router;
