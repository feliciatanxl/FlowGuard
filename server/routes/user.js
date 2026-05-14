const express = require('express');
const router = express.Router();
const { User } = require('../models');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const yup = require('yup');
require('dotenv').config();

// REGISTRATION (For creating the initial FM/Tenant accounts)
router.post("/register", async (req, res) => {
    let data = req.body;
    let validationSchema = yup.object({
        name: yup.string().trim().required(),
        email: yup.string().trim().email().required(),
        password: yup.string().trim().min(8).required(),
        role: yup.string().oneOf(['FM', 'Tenant'])
    });

    try {
        data = await validationSchema.validate(data, { abortEarly: false });
        // Hash the password before saving
        data.password = await bcrypt.hash(data.password, 10);
        let result = await User.create(data);
        res.json({ message: "User registered successfully", id: result.id });
    } catch (err) {
        res.status(400).json({ errors: err.errors || err.message });
    }
});

// LOGIN
router.post("/login", async (req, res) => {
    let { email, password } = req.body;
    
    try {
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
        res.status(500).json({ message: err.message });
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