# AI Clinical Assistant Setup Guide

## Overview
The AI Clinical Assistant is powered by Google Gemini (free tier) and provides:
- **SOAP Notes Generation**: Generate clinical notes from symptoms
- **Diagnosis Suggestions**: AI-powered differential diagnosis
- **Drug Interaction Checker**: Check for dangerous drug combinations
- **Patient Summary**: AI-generated comprehensive patient overview

## Setup Instructions

### Step 1: Get a Free Gemini API Key

1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the generated API key

### Step 2: Configure the Backend

Add the API key to your environment:

**Option A: Environment Variable (Recommended for Production)**
```bash
export GEMINI_API_KEY="your-api-key-here"
```

**Option B: Add to server.js (Quick Testing)**
Add this line at the top of `server.js`:
```javascript
process.env.GEMINI_API_KEY = "your-api-key-here";
```

### Step 3: Restart the Backend
```bash
cd vita-backend
npm start
```

## Usage

### From Doctor Dashboard:
1. Click the **"🤖 AI Assistant"** button in Quick Actions
2. Or click the **"🤖 AI"** button on any patient card

### Features:

#### 1. SOAP Notes Generation
- Enter symptoms and vitals
- Click "Generate SOAP Notes"
- Review and apply to medical record

#### 2. Diagnosis Suggestions
- Describe symptoms
- Get AI-powered differential diagnoses
- See recommended tests

#### 3. Drug Interactions
- Enter medications (comma-separated)
- Check for dangerous interactions
- View allergy warnings

#### 4. Patient Summary
- Select a patient
- Generate comprehensive AI summary
- View risk factors and recommendations

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ai/status` | GET | Check if AI is configured |
| `/api/ai/generate-notes` | POST | Generate SOAP notes |
| `/api/ai/suggest-diagnosis` | POST | Get diagnosis suggestions |
| `/api/ai/check-interactions` | POST | Check drug interactions |
| `/api/ai/patient-summary` | POST | Generate patient summary |

## Free Tier Limits

Google Gemini free tier includes:
- **60 requests per minute**
- **1,500 requests per day**
- **1 million tokens per minute**

This is more than enough for testing and moderate clinical use.

## Language Support

The AI Assistant fully supports:
- 🇬🇧 English
- 🇸🇦 Arabic (العربية)

The language is automatically detected based on the user's language preference in the app.

## Important Disclaimer

⚠️ **Medical Disclaimer**: This AI assistant is for informational and documentation assistance only. It does not replace professional medical judgment. All AI-generated suggestions must be reviewed and validated by a qualified healthcare professional before use.

## Troubleshooting

### "AI service not configured" error
- Make sure `GEMINI_API_KEY` environment variable is set
- Restart the backend after setting the key

### "Failed to generate" error
- Check your internet connection
- Verify the API key is valid
- Check if you've exceeded rate limits

### Arabic text not displaying correctly
- Ensure your browser supports RTL
- Check that the language is set to Arabic in the app
