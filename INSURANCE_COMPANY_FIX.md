// Summary of Insurance Company Selection Fixes

/**
 * PROBLEM 1: Insurance company form showing IDs instead of names in dashboard
 * CAUSE: Orphaned insurance company IDs in claims that don't match any database records
 * 
 * SOLUTION:
 * - Backend now validates that insurance company exists before saving claim
 * - Only accepts valid MongoDB ObjectIds from database
 * - Rejects invalid or non-existent IDs with clear error message
 */

/**
 * PROBLEM 2: Insurance companies list in form might have null IDs
 * CAUSE: Fallback to string label when c._id was undefined
 * 
 * SOLUTION:
 * - Frontend now uses c._id directly without fallback
 * - Backend ensures only active insurance companies are returned
 * - API response always contains valid company objects with _id
 */

/**
 * FILES MODIFIED:
 * 
 * 1. /vita-backend/routes/insuranceClaimsAPI.js (POST /:pharmacyId)
 *    - Added validation to check if insuranceCompany ID exists in database
 *    - Rejects if not a valid ObjectId
 *    - Rejects if company doesn't exist in InsuranceCompany collection
 *    - Added InsuranceCompany model import
 * 
 * 2. /vita-backend/routes/insuranceCompanyRoutes.js (GET /)
 *    - Changed default query to filter for status: 'active'
 *    - Ensures only active companies are returned to forms
 * 
 * 3. /vita-web/src/pages/pharmacy/PharmacyDashboard.jsx
 *    - Removed fallback string value for c._id
 *    - Now always uses actual database _id as option value
 *    - Ensures only valid IDs are sent to backend
 */

/**
 * TESTING:
 * 
 * 1. Try sending a claim with valid insurance company ID
 *    Expected: Success, claim saved with valid ID
 * 
 * 2. Try sending a claim with invalid/non-existent ID
 *    Expected: Error: "Insurance company not found in database"
 * 
 * 3. Check pharmacy form insurance company dropdown
 *    Expected: Shows all active companies from database
 *    Each option has a valid _id value
 * 
 * 4. Check union dashboard statistics
 *    Expected: All companies show by name, not by ID
 *    Stats updated dynamically when new claims arrive
 */
