const Record = require('../models/Record');

// Create a new record.
exports.createRecord = async (req, res) => {
  try {
    const { doctorId, patientId, patientName, appointmentDate, issueDescription, treatmentPlan, ePrescription } = req.body;
    // Ensure required fields are provided.
    if (!doctorId || !patientId || !patientName) {
      return res.status(400).json({ message: 'Doctor, patient, and patient name are required.' });
    }
    
    // Create a new record without checking for an existing record.
    const newRecord = new Record({
      doctorId,
      patientId,
      patientName,
      appointmentDate,
      issueDescription,
      treatmentPlan,
      ePrescription
    });
    await newRecord.save();
    res.status(201).json({ message: 'Record created successfully', record: newRecord });
  } catch (error) {
    console.error('Error creating record:', error);
    res.status(500).json({ message: 'Server error while creating record' });
  }
};


// Update an existing record.
exports.updateRecord = async (req, res) => {
  try {
    const { recordId } = req.params;
    const updateData = req.body;
    const updatedRecord = await Record.findByIdAndUpdate(recordId, { $set: updateData }, { new: true });
    if (!updatedRecord) {
      return res.status(404).json({ message: 'Record not found' });
    }
    res.json({ message: 'Record updated successfully', record: updatedRecord });
  } catch (error) {
    console.error('Error updating record:', error);
    res.status(500).json({ message: 'Server error while updating record' });
  }
};

// Delete a record.
exports.deleteRecord = async (req, res) => {
  try {
    const { recordId } = req.params;
    const deletedRecord = await Record.findByIdAndDelete(recordId);
    if (!deletedRecord) {
      return res.status(404).json({ message: 'Record not found' });
    }
    res.json({ message: 'Record deleted successfully' });
  } catch (error) {
    console.error('Error deleting record:', error);
    res.status(500).json({ message: 'Server error while deleting record' });
  }
};

// Get all records for a doctor.
exports.getDoctorRecords = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const records = await Record.find({ doctorId }).sort({ createdAt: -1 });
    res.json({ records });
  } catch (error) {
    console.error('Error fetching records:', error);
    res.status(500).json({ message: 'Server error while fetching records' });
  }
};

// Search records.
exports.searchRecords = async (req, res) => {
  try {
    const { doctorId, keyword } = req.query;
    const records = await Record.find({
      doctorId,
      $or: [
        { patientName: { $regex: keyword, $options: 'i' } },
        { issueDescription: { $regex: keyword, $options: 'i' } },
        { treatmentPlan: { $regex: keyword, $options: 'i' } },
        { ePrescription: { $regex: keyword, $options: 'i' } },
      ],
    });
    res.json({ records });
  } catch (error) {
    console.error('Error searching records:', error);
    res.status(500).json({ message: 'Server error while searching records' });
  }
};

// Get all records for a given patient.
exports.getRecordsByPatient = async (req, res) => {
  try {
    const { patientId } = req.params;
    const records = await Record.find({ patientId }).sort({ createdAt: -1 });
    res.json({ records });
  } catch (error) {
    console.error('Error fetching records by patient:', error);
    res.status(500).json({ message: 'Server error while fetching records by patient' });
  }
};

// NEW: Get a single record by its ID.
exports.getRecordById = async (req, res) => {
  try {
    const { recordId } = req.params;
    const record = await Record.findById(recordId);
    if (!record) {
      return res.status(404).json({ message: 'Record not found' });
    }
    res.json({ record });
  } catch (error) {
    console.error('Error fetching record:', error);
    res.status(500).json({ message: 'Server error while fetching record' });
  }
};
