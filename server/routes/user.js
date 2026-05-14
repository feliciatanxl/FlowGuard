const express = require('express');
const router = express.Router();
const { User } = require('../models');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const yup = require('yup');
const axios = require('axios'); 
require('dotenv').config();

// REGISTRATION (For creating the initial FM/Tenant accounts)
router.post("/register", async (req, res) => {
    // 1. Separate the token from the rest of the user data
    const { recaptchaToken, ...userData } = req.body;
    
    try {
        // --- START RECAPTCHA VERIFICATION ---
        if (!recaptchaToken) {
            return res.status(400).json({ errors: ["Security token missing. Please refresh the page."] });
        }

        const verificationUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${recaptchaToken}`;
        const googleResponse = await axios.post(verificationUrl);
        const { success, score } = googleResponse.data;

        // Check the score (0.5 threshold)
        if (!success || score < 0.5) {
            console.warn(`Blocked potential bot registration. Score: ${score}`);
            return res.status(403).json({ errors: ["Security check failed. Bot activity detected."] });
        }
        // --- END RECAPTCHA VERIFICATION ---

        // 2. Proceed with Yup Validation using the clean userData
        let validationSchema = yup.object({
            name: yup.string().trim().required(),
            email: yup.string().trim().email().required(),
            password: yup.string().trim().min(8).required(),
            role: yup.string().oneOf(['FM', 'Tenant'])
        });

        let validatedData = await validationSchema.validate(userData, { abortEarly: false });
        
        // Hash the password before saving
        validatedData.password = await bcrypt.hash(validatedData.password, 10);
        let result = await User.create(validatedData);
        res.json({ message: "User registered successfully", id: result.id });

    } catch (err) {
        // Yup throws validation errors in an 'errors' array, handle gracefully
        res.status(400).json({ errors: err.errors || [err.message] });
    }
});

// LOGIN
router.post("/login", async (req, res) => {
    let { email, password, recaptchaToken } = req.body;
    
    try {
        // --- START RECAPTCHA VERIFICATION ---
        if (!recaptchaToken) {
            return res.status(400).json({ message: "Security token missing. Please refresh the page." });
        }

        // Send the token to Google's secret vault
        const verificationUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${recaptchaToken}`;
        const googleResponse = await axios.post(verificationUrl);
        const { success, score } = googleResponse.data;

        // Check the score (0.5 is a standard safe threshold)
        if (!success || score < 0.5) {
            console.warn(`Blocked potential bot login. Score: ${score}`);
            return res.status(403).json({ message: "Security check failed. Bot activity detected." });
        }
        // --- END RECAPTCHA VERIFICATION ---

        // Proceed with your existing database logic!
        const user = await User.findOne({ where: { email } });
        if (!user) return res.status(400).json({ message: "Invalid email or password" });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ message: "Invalid email or password" });

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.APP_SECRET, 
            { expiresIn: '1h' }
        );

        res.json({ 
            token, 
            user: { id: user.id, name: user.name, role: user.role } 
        });
    } catch (err) {
        console.error("Login Error:", err.message);
        res.status(500).json({ message: "Internal server error during authentication" });
    }
});

// Get all users for the Management Table
router.get("/", async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: ['id', 'name', 'email', 'role', 'createdAt'] // Exclude passwords for security
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;