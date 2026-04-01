// controllers/patientController.js
const bcrypt = require('bcrypt');
const User = require('../models/User'); // Your User schema

exports.addPatient = async (req, res) => {
   const {email} = req.body
   const doctorid = req.params.doctorId
  if(email){
    const doctor = User.findById(doctorid)
    doctor.patients.push(email);
    await doctor.save();
    console.log('sucess')
  }else{
    try {
      const { fullName, age, gender, mobileNumber, email, address, password } = req.body;
      if (!fullName || !age || !gender || !mobileNumber || !email || !address || !password) {
        return res.status(400).json({ message: 'All fields are required' });
      }
      
      // Hash the password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);
  
      // Create a new patient with the hashed password.
      const newPatient = new User({
        fullName,
        age,
        gender,
        mobileNumber,
        email,
        address,
        password: hashedPassword,
        role: 'User', // Assuming patient role is 'User'
      });
  
      await newPatient.save();
      res.status(200).json({ message: 'Patient added successfully' });
    } catch (error) {
      console.error('Error adding patient:', error);
      res.status(500).json({ message: 'Server error while adding patient' });
    }
  }

  
};
