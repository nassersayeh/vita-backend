const express = require('express');
const router = express.Router();
const Prescription = require('../models/EPrescription'); // Updated to use Prescription model
const Notification = require('../models/Notification');
const User = require('../models/User')
router.get('/', async (req, res) => {
  try {
    const { doctorId, patientId, date } = req.query; // Changed userId to patientId for consistency
    if (!doctorId && !patientId) {
      return res.status(400).json({ message: 'Either doctorId or patientId query parameter is required.' });
    }
    const filter = {};
    if (doctorId) filter.doctorId = doctorId;
    if (patientId) filter.patientId = patientId;
    if (date) {
      // Filter by date (same day)
      const startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
      filter.date = { $gte: startDate, $lte: endDate };
    }
    const prescriptions = await Prescription.find(filter)
      .populate('doctorId', 'fullName specialty')
      .populate('products.productId', 'name')
      .populate('products.drugId', 'name')
      .sort({ date: -1 });
    res.json(prescriptions);
  } catch (error) {
    console.error("Error fetching prescriptions:", error);
    res.status(500).json({ message: "Server error fetching prescriptions" });
  }
});

// POST a new prescription for a patient.
// The URL uses patientId, and doctorId and products array are in the body.
router.post('/:patientId/prescriptions', async (req, res) => {
  try {
    const patientId = req.params.patientId;
    const { doctorId, products } = req.body;
    if (!patientId || !doctorId || !products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ message: 'patientId, doctorId, and a non-empty array of products are required.' });
    }
    // Validate each product has productId, dose, and name
    const hasInvalidProduct = products.some(p => !p.productId || !p.dose || !p.name);
    if (hasInvalidProduct) {
      return res.status(400).json({ message: 'Each product must have a productId, dose, and name.' });
    }
    const newPrescription = new Prescription({
      patientId,
      doctorId,
      products, // Store the array of { productId, dose, name }
      date: new Date(),
    });
    await newPrescription.save();
    const doctor = await User.findById(doctorId)
    await Notification.create({
      user: patientId,
      type: 'request',
      message: `لقد قام ${doctor.fullName || 'غير معروف'} بكتابة وصفة طبية جديدة لك`,
      relatedId: newPrescription._id
    });

    res.status(201).json(newPrescription);
  } catch (error) {
    console.error("Error creating prescription:", error);
    res.status(500).json({ message: "Server error creating prescription" });
  }
});

// GET prescriptions for a patient.
router.get('/:patientId/prescriptions', async (req, res) => {
  try {
    const { patientId } = req.params;
    const prescriptions = await Prescription.find({ patientId });
    console.log(prescriptions);
    res.json(prescriptions);
  } catch (error) {
    console.error("Error fetching prescriptions:", error);
    res.status(500).json({ message: "Server error fetching prescriptions" });
  }
});

// POST endpoint to generate and download PDF
router.get('/:prescriptionId/pdf', async (req, res) => {
  try {
    const { prescriptionId } = req.params;
    const prescription = await Prescription.findById(prescriptionId).populate('patientId', 'fullName mobileNumber');

    if (!prescription) {
      return res.status(404).json({ message: 'Prescription not found' });
    }

    // Prepare LaTeX content
    const latexContent = `
\\documentclass[a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[arabic]{babel}
\\usepackage{fontspec}
\\setmainfont{Amiri} % Ensure Amiri font is installed on the server
\\usepackage{geometry}
\\geometry{a4paper, margin=1in}
\\usepackage{graphicx}

\\begin{document}

% Header
\\begin{center}
\\includegraphics[width=3cm]{vita-logo.png} % Replace with actual path to logo on server
\\vspace{0.5cm}
{\\Large \\textbf{وصفة فيتا}} \\\\
{\\small صحتك، مستقبلك}
\\end{center}
\\hrule
\\vspace{1cm}

% Body: Prescription Details
\\begin{flushright}
\\textbf{اسم المريض:} ${prescription.patientId.fullName || 'غير متوفر'} \\\\
\\textbf{رقم الهاتف:} ${prescription.patientId.mobileNumber || 'غير متوفر'} \\\\
\\textbf{التاريخ:} ${new Date(prescription.date).toLocaleDateString('ar-EG')} \\\\
\\vspace{0.5cm}
\\textbf{المنتجات:}
\\begin{itemize}
${prescription.products.map((p, i) => `\\item ${i + 1}. ${p.name} - الجرعة: ${p.dose}`).join('\n')}
\\end{itemize}
\\end{flushright}

% Stamp (simulated with a faded logo)
\\begin{center}
\\includegraphics[width=5cm]{vita-logo.png} % Replace with actual path
\\end{center}

% Footer
\\hrule
\\vspace{0.5cm}
\\begin{flushright}
\\small{تواصل معنا: info@aipilot.ps | +970567600951 \\\\ زورونا: www.vita.ps}
\\end{flushright}

\\end{document}
    `.trim();

    // Write LaTeX to a temporary file
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
    const latexFilePath = path.join(tempDir, 'prescription.tex');
    fs.writeFileSync(latexFilePath, latexContent);

    // Generate PDF using latexmk with xelatex
    const pdfFilePath = path.join(tempDir, 'prescription.pdf');
    await new Promise((resolve, reject) => {
      exec(`latexmk -xelatex -output-directory=${tempDir} ${latexFilePath}`, (error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    // Send the PDF as a downloadable file
    res.download(pdfFilePath, 'الوصفة_الطبية.pdf', (err) => {
      if (err) {
        console.error('Error sending PDF:', err);
        res.status(500).json({ message: 'Error generating PDF' });
      }
      // Clean up temporary files
      fs.unlinkSync(latexFilePath);
      fs.unlinkSync(pdfFilePath);
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ message: 'Server error generating PDF' });
  }
});

// GET a single prescription.
router.get('/:prescriptionId', async (req, res) => {
  try {
    const { prescriptionId } = req.params;
    const prescription = await Prescription.findById(prescriptionId);
    if (!prescription) {
      return res.status(404).json({ message: "Prescription not found" });
    }
    res.json({ prescription });
  } catch (error) {
    console.error("Error fetching prescription:", error);
    res.status(500).json({ message: "Server error fetching prescription" });
  }
});

// PUT update a prescription.
router.put('/:prescriptionId', async (req, res) => {
  try {
    const { prescriptionId } = req.params;
    const updateData = req.body;
    // Ensure required fields are present if updated
    if (updateData.products && (!Array.isArray(updateData.products) || updateData.products.length === 0)) {
      return res.status(400).json({ message: 'products must be a non-empty array.' });
    }
    if (updateData.products) {
      const hasInvalidProduct = updateData.products.some(p => !p.productId || !p.dose || !p.name);
      if (hasInvalidProduct) {
        return res.status(400).json({ message: 'Each product must have a productId, dose, and name.' });
      }
    }
    const updatedPrescription = await Prescription.findByIdAndUpdate(prescriptionId, { $set: updateData }, { new: true });
    if (!updatedPrescription) {
      return res.status(404).json({ message: "Prescription not found" });
    }
    res.json({ message: "Prescription updated successfully", prescription: updatedPrescription });
  } catch (error) {
    console.error("Error updating prescription:", error);
    res.status(500).json({ message: "Server error updating prescription" });
  }
});

// DELETE a prescription.
router.delete('/:prescriptionId', async (req, res) => {
  try {
    const { prescriptionId } = req.params;
    const deletedPrescription = await Prescription.findByIdAndDelete(prescriptionId);
    if (!deletedPrescription) {
      return res.status(404).json({ message: "Prescription not found" });
    }
    res.json({ message: "Prescription deleted successfully" });
  } catch (error) {
    console.error("Error deleting prescription:", error);
    res.status(500).json({ message: "Server error deleting prescription" });
  }
});

// POST renewal request for a prescription
router.post('/:prescriptionId/renewal', async (req, res) => {
  try {
    const { prescriptionId } = req.params;
    const { notes } = req.body;

    const prescription = await Prescription.findById(prescriptionId)
      .populate('patientId', 'fullName email')
      .populate('doctorId', 'fullName email');

    if (!prescription) {
      return res.status(404).json({ message: "Prescription not found" });
    }

    // Check if there's already a pending renewal request
    const hasPendingRequest = prescription.renewalRequests.some(request => request.status === 'pending');
    if (hasPendingRequest) {
      return res.status(400).json({ message: "A renewal request is already pending for this prescription" });
    }

    // Add renewal request
    prescription.renewalRequests.push({
      requestDate: new Date(),
      status: 'pending',
      notes: notes || ''
    });

    await prescription.save();

    // Create notification for doctor
    const notification = new Notification({
      userId: prescription.doctorId._id,
      title: 'Prescription Renewal Request',
      message: `${prescription.patientId.fullName} has requested renewal for prescription ${prescription.prescriptionNumber}`,
      type: 'prescription_renewal',
      relatedId: prescription._id,
      isRead: false
    });
    await notification.save();

    res.json({ 
      message: "Renewal request submitted successfully",
      renewalRequest: prescription.renewalRequests[prescription.renewalRequests.length - 1]
    });
  } catch (error) {
    console.error("Error requesting prescription renewal:", error);
    res.status(500).json({ message: "Server error requesting renewal" });
  }
});

// GET renewal requests for a doctor
router.get('/doctor/:doctorId/renewal-requests', async (req, res) => {
  try {
    const { doctorId } = req.params;
    const prescriptions = await Prescription.find({ 
      doctorId,
      'renewalRequests.status': 'pending'
    })
    .populate('patientId', 'fullName email phone')
    .populate('products.productId', 'name')
    .populate('products.drugId', 'name')
    .sort({ 'renewalRequests.requestDate': -1 });

    const renewalRequests = [];
    prescriptions.forEach(prescription => {
      prescription.renewalRequests.forEach(request => {
        if (request.status === 'pending') {
          renewalRequests.push({
            _id: request._id,
            prescriptionId: prescription._id,
            prescriptionNumber: prescription.prescriptionNumber,
            patient: prescription.patientId,
            diagnosis: prescription.diagnosis,
            products: prescription.products,
            requestDate: request.requestDate,
            notes: request.notes,
            status: request.status
          });
        }
      });
    });

    res.json(renewalRequests);
  } catch (error) {
    console.error("Error fetching renewal requests:", error);
    res.status(500).json({ message: "Server error fetching renewal requests" });
  }
});

// PUT approve/reject renewal request
router.put('/:prescriptionId/renewal/:requestId', async (req, res) => {
  try {
    const { prescriptionId, requestId } = req.params;
    const { action, rejectionReason } = req.body; // action: 'approve' or 'reject'

    const prescription = await Prescription.findById(prescriptionId);
    if (!prescription) {
      return res.status(404).json({ message: "Prescription not found" });
    }

    const renewalRequest = prescription.renewalRequests.id(requestId);
    if (!renewalRequest) {
      return res.status(404).json({ message: "Renewal request not found" });
    }

    if (renewalRequest.status !== 'pending') {
      return res.status(400).json({ message: "Request has already been processed" });
    }

    if (action === 'approve') {
      renewalRequest.status = 'approved';
      renewalRequest.approvedDate = new Date();
      
      // Reset prescription validity for renewal
      prescription.isValid = true;
      prescription.dispensedAt = null;
      prescription.dispensedBy = null;
      prescription.dispensingNotes = '';
      prescription.dispensedCount = 0;
      
      // Set new expiry date (7 days from now)
      prescription.expiryDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      
    } else if (action === 'reject') {
      renewalRequest.status = 'rejected';
      renewalRequest.rejectionReason = rejectionReason || 'Request rejected by doctor';
    } else {
      return res.status(400).json({ message: "Invalid action. Use 'approve' or 'reject'" });
    }

    await prescription.save();

    // Create notification for patient
    const notification = new Notification({
      userId: prescription.patientId,
      title: action === 'approve' ? 'Prescription Renewal Approved' : 'Prescription Renewal Rejected',
      message: action === 'approve' 
        ? `Your prescription ${prescription.prescriptionNumber} has been renewed`
        : `Your prescription renewal request for ${prescription.prescriptionNumber} was rejected: ${rejectionReason || 'Request rejected by doctor'}`,
      type: 'prescription_renewal_response',
      relatedId: prescription._id,
      isRead: false
    });
    await notification.save();

    res.json({ 
      message: `Renewal request ${action}d successfully`,
      renewalRequest
    });
  } catch (error) {
    console.error("Error processing renewal request:", error);
    res.status(500).json({ message: "Server error processing renewal request" });
  }
});

module.exports = router;