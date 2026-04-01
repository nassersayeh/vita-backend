# WhatsApp Cloud API Setup Guide (FREE)

This guide explains how to set up WhatsApp Cloud API from Meta for sending free verification codes.

## Benefits
- **1,000 FREE service conversations per month**
- No credit card required for the free tier
- Official Meta/WhatsApp API
- Reliable delivery

## Step 1: Create a Meta Developer Account

1. Go to [Meta for Developers](https://developers.facebook.com/)
2. Click "Get Started" and log in with your Facebook account
3. Accept the terms and complete your developer profile

## Step 2: Create a New App

1. Go to [My Apps](https://developers.facebook.com/apps/)
2. Click "Create App"
3. Select "Business" as the app type
4. Fill in app name (e.g., "Vita Healthcare")
5. Click "Create App"

## Step 3: Add WhatsApp Product

1. In your app dashboard, find "Add Products to Your App"
2. Find "WhatsApp" and click "Set Up"
3. You'll be redirected to WhatsApp setup

## Step 4: Get API Credentials

1. In the WhatsApp section, go to "API Setup"
2. You'll see:
   - **Phone Number ID**: Copy this
   - **WhatsApp Business Account ID**: Note this
   - **Temporary Access Token**: For testing (expires in 24 hours)

3. For **Permanent Access Token**:
   - Go to Business Settings > System Users
   - Create a new system user with Admin access
   - Generate a token with `whatsapp_business_messaging` permission

## Step 5: Add Test Phone Numbers

1. In "API Setup", scroll to "To" field
2. Click "Manage phone number list"
3. Add your phone number and verify with OTP
4. You can add up to 5 test numbers for free

## Step 6: Create Message Template (Optional but Recommended)

For production, create a template:

1. Go to "Message Templates" in WhatsApp section
2. Click "Create Template"
3. Settings:
   - Name: `verification_code`
   - Category: `AUTHENTICATION`
   - Language: English
4. Body: `Your Vita verification code is: {{1}}. This code expires in 10 minutes.`
5. Submit for approval (usually takes a few minutes)

## Step 7: Update .env File

```env
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id_here
WHATSAPP_ACCESS_TOKEN=your_permanent_access_token_here
```

## Step 8: Install Dependencies

```bash
cd vita-backend
npm install axios
```

## Testing

1. Start your backend server
2. Enable 2FA in the app
3. Check your WhatsApp for the verification code

## Troubleshooting

### "Message failed to send"
- Ensure the recipient has WhatsApp installed
- Check if the phone number is in the test numbers list (for sandbox)
- Verify your access token hasn't expired

### "Template not found"
- Wait for template approval
- Use the exact template name as created
- Ensure language code matches

### Rate Limits
- Free tier: 1,000 service conversations/month
- Each unique user counts as 1 conversation per 24-hour window

## Production Checklist

1. ✅ Create permanent access token (not temporary)
2. ✅ Add phone number to Meta Business verification
3. ✅ Create and get approval for message templates
4. ✅ Upgrade to a Meta Business Account for higher limits if needed

## Links

- [WhatsApp Cloud API Documentation](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [Message Templates](https://developers.facebook.com/docs/whatsapp/message-templates)
- [Pricing](https://developers.facebook.com/docs/whatsapp/pricing)
