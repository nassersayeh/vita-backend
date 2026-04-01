# Auto-Mark Appointments as Paid - Cron Job Setup

## Overview
This system automatically marks confirmed appointments as paid after 24 hours. This helps track revenue and ensures accurate financial reporting.

## How It Works
- Appointments with status `confirmed` that are older than 24 hours and not yet marked as paid will be automatically marked
- The system uses the doctor's `consultationFee` from their profile
- A flag `autoMarkedAsPaid` is set to `true` to distinguish from manually marked payments

## Setting Up the Cron Job

### Option 1: Using cron (Linux/Mac)

1. Edit your crontab:
```bash
crontab -e
```

2. Add this line to run every hour:
```bash
0 * * * * curl -X POST http://localhost:5000/api/appointments/auto-mark-paid
```

Or run once daily at 2 AM:
```bash
0 2 * * * curl -X POST http://localhost:5000/api/appointments/auto-mark-paid
```

### Option 2: Using node-cron (Recommended)

1. Install node-cron:
```bash
npm install node-cron
```

2. Add to your `server.js`:
```javascript
const cron = require('node-cron');

// Run every hour
cron.schedule('0 * * * *', async () => {
  try {
    console.log('Running auto-mark-paid cron job...');
    const axios = require('axios');
    const response = await axios.post('http://localhost:5000/api/appointments/auto-mark-paid');
    console.log('Auto-mark-paid result:', response.data);
  } catch (error) {
    console.error('Auto-mark-paid cron error:', error.message);
  }
});
```

### Option 3: Using PM2

1. Create a cron script file `cron/auto-mark-paid.js`:
```javascript
const axios = require('axios');

axios.post('http://localhost:5000/api/appointments/auto-mark-paid')
  .then(response => {
    console.log('Success:', response.data);
    process.exit(0);
  })
  .catch(error => {
    console.error('Error:', error.message);
    process.exit(1);
  });
```

2. Add to PM2 ecosystem:
```javascript
module.exports = {
  apps: [
    {
      name: 'vita-backend',
      script: './server.js'
    },
    {
      name: 'auto-mark-paid',
      script: './cron/auto-mark-paid.js',
      cron_restart: '0 * * * *', // Every hour
      autorestart: false
    }
  ]
};
```

## API Endpoints

### POST /api/appointments/auto-mark-paid
Manually trigger the auto-marking process (also used by cron jobs)

**Response:**
```json
{
  "message": "Auto-marked 5 appointments as paid",
  "markedCount": 5
}
```

### GET /api/appointments/doctor/:doctorId/revenue
Get revenue statistics for a doctor

**Query Parameters:**
- `startDate` (optional): Filter from this date
- `endDate` (optional): Filter until this date

**Response:**
```json
{
  "totalRevenue": 5000,
  "totalAppointments": 20,
  "autoMarkedCount": 15,
  "manualMarkedCount": 5,
  "appointments": [...]
}
```

## Testing

Test the auto-marking endpoint:
```bash
curl -X POST http://localhost:5000/api/appointments/auto-mark-paid
```

## Notes

- Appointments without a `consultationFee` in the doctor's profile will NOT be auto-marked
- Only appointments with status `confirmed` are eligible for auto-marking
- Cancelled appointments are never marked as paid
- The 24-hour timer starts from the appointment's `appointmentDateTime`, not when it was confirmed
