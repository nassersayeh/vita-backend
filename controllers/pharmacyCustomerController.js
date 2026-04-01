const PharmacyCustomer = require('../models/PharmacyCustomer');
const { sendPharmacyWhatsAppMessage } = require('../services/whatsappService');

exports.getAllCustomers = async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const customers = await PharmacyCustomer.find({ pharmacyId });
    res.json({ customers });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching customers' });
  }
};

exports.createCustomer = async (req, res) => {
  try {
    const { pharmacyId } = req.params;
    const { name, phone, notes } = req.body;
    const customer = new PharmacyCustomer({ pharmacyId, name, phone, notes });
    await customer.save();
    res.json({ customer });
  } catch (error) {
    res.status(500).json({ message: 'Error creating customer' });
  }
};

exports.updateCustomer = async (req, res) => {
  try {
    const { customerId } = req.params;
    const { name, phone, notes } = req.body;
    const customer = await PharmacyCustomer.findByIdAndUpdate(customerId, { name, phone, notes }, { new: true });
    res.json({ customer });
  } catch (error) {
    res.status(500).json({ message: 'Error updating customer' });
  }
};

exports.getCustomer = async (req, res) => {
  try {
    const { customerId } = req.params;
    const customer = await PharmacyCustomer.findById(customerId);
    res.json({ customer });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching customer' });
  }
};

exports.sendWhatsAppMessage = async (req, res) => {
  try {
    const { pharmacyId, customerId } = req.params;
    const { message } = req.body;
    const customer = await PharmacyCustomer.findById(customerId);
    if (!customer) return res.status(404).json({ message: 'Customer not found' });
    console.log(`Sending WhatsApp message from pharmacy ${pharmacyId} to customer ${customerId} phone ${customer.phone}`);
    const { sendPharmacyWhatsAppMessage, initializePharmacyWhatsApp } = require('../services/whatsappService');
    // Ensure the pharmacy WhatsApp client is initialized
    await initializePharmacyWhatsApp(pharmacyId);
    await sendPharmacyWhatsAppMessage(pharmacyId, customer.phone, message);
    res.json({ success: true });
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    res.status(500).json({ message: error.message || 'Error sending WhatsApp message' });
  }
};
