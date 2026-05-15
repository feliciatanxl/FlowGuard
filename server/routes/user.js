const express = require('express');
const router = express.Router();
const { User, Attendance, Invite } = require('../models'); 
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const yup = require('yup');
const axios = require('axios'); 
const crypto = require('crypto'); 
const { verifyToken } = require('../middlewares/auth');
require('dotenv').config();

// --- MIDDLEWARE ---
const authenticateToken = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; 

    if (!token) return res.status(401).json({ message: "Access denied. No token provided." });

    jwt.verify(token, process.env.APP_SECRET, async (err, decoded) => {
        if (err) return res.status(403).json({ message: "Invalid or expired token." });

        const user = await User.findByPk(decoded.id);
        if (!user || user.isActive === false) {
            return res.status(403).json({ message: "Account suspended. Session terminated." });
        }

        req.user = decoded;
        next();
    });
};

// --- REGISTRATION (Multi-Level Security Gate) ---
router.post("/register", async (req, res) => {
    const { recaptchaToken, ...userData } = req.body;
    try {
        if (!recaptchaToken) return res.status(400).json({ errors: ["Security token missing."] });

        // 1. reCAPTCHA Verification
        const params = new URLSearchParams();
        params.append('secret', process.env.RECAPTCHA_SECRET_KEY);
        params.append('response', recaptchaToken);

        const googleResponse = await axios.post('https://www.google.com/recaptcha/api/siteverify', params, { 
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' } 
        });
        
        if (!googleResponse.data.success || googleResponse.data.score < 0.5) {
            return res.status(403).json({ errors: ["Security check failed. Please try again."] });
        }

        // 2. Data Validation
        let validationSchema = yup.object({
            name: yup.string().trim().required("Full name is required"),
            email: yup.string().trim().email("Invalid email format").required("Email is required"),
            password: yup.string().trim().min(8, "Password must be at least 8 characters").required(),
            role: yup.string().oneOf(['FM', 'Tenant', 'Staff']).required("Role is required"),
            tenantCode: yup.string().required("Access code is required")
        });

        let validatedData = await validationSchema.validate(userData, { abortEarly: false });
        
        // --- 3. THE SECURITY GATE ---

        // BLOCK A: Prevent anyone from registering as FM publicly
        if (validatedData.role === 'FM') {
            return res.status(403).json({ errors: ["Administrative accounts cannot be created publicly."] });
        }

        // BLOCK B: Tenant Registration (One-Time Invite Check)
        if (validatedData.role === 'Tenant') {
            const invite = await Invite.findOne({ 
                where: { code: validatedData.tenantCode, role: 'Tenant', isUsed: false } 
            });

            if (!invite) {
                return res.status(401).json({ errors: ["Invalid or used Invitation Code. Contact the FM office."] });
            }

            // Check Expiration (e.g., 24h/48h set when invite was created)
            if (new Date() > invite.expiresAt) {
                return res.status(401).json({ errors: ["This invitation code has expired."] });
            }

            // Mark invite as used so it cannot be used again
            await invite.update({ isUsed: true });
        }

        // BLOCK C: Staff Registration (Hybrid Security Logic)
        if (validatedData.role === 'Staff') {
            const employer = await User.findOne({ 
                where: { role: 'Tenant', companyCode: validatedData.tenantCode } 
            });

            if (!employer) {
                return res.status(400).json({ errors: ["Invalid Unit Registration Code. Contact your manager."] });
            }

            // Time Expiration Check (48 Hours)
            const fortyEightHours = 48 * 60 * 60 * 1000;
            const isExpired = Date.now() - new Date(employer.codeCreatedAt).getTime() > fortyEightHours;

            if (isExpired) {
                return res.status(401).json({ errors: ["This unit code has expired (48h limit). Ask your manager to refresh it."] });
            }

            // Usage Limit Check (Capacity)
            if (employer.codeCurrentUsage >= employer.codeMaxUsage) {
                return res.status(401).json({ errors: ["Registration capacity reached for this unit."] });
            }

            // Link Staff to Tenant and increment usage
            validatedData.managerId = employer.id; 
            await employer.increment('codeCurrentUsage');
        }

        // 4. Hash & Save
        validatedData.password = await bcrypt.hash(validatedData.password, 10);
        let result = await User.create(validatedData);

        res.json({ message: "Account registered successfully.", id: result.id });

    } catch (err) {
        console.error("Registration Error Logic:", err);
        let errorMessages = [];
        if (err.name === 'SequelizeUniqueConstraintError') {
            errorMessages = ["This email is already registered in our system."];
        } else if (err.errors) {
            errorMessages = err.errors.map(e => (typeof e === 'object' ? e.message : e));
        } else {
            errorMessages = [err.message || "An unexpected system error occurred."];
        }
        res.status(400).json({ errors: errorMessages });
    }
});

// --- FM ONLY: Get all generated invites ---
router.post("/invite-tenant", authenticateToken, async (req, res) => { 
    try {
        if (req.user.role !== 'FM') return res.status(403).json({ message: "Access Denied." });

        const inviteCode = `INVITE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const expiry = new Date(Date.now() + 48 * 60 * 60 * 1000); 

        // CRITICAL: Ensure Invite is imported at the top of this file
        await Invite.create({
            code: inviteCode,
            role: 'Tenant',
            expiresAt: expiry
        });

        res.json({ inviteCode, message: "Invitation generated." });
    } catch (err) {
        console.error("Invite Error:", err); 
        res.status(500).json({ error: "Failed to generate invitation." });
    }
});

// --- KEY GENERATION (Updated to reset Hybrid Fields) ---
router.put("/generate-code", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'Tenant') return res.status(403).json({ message: "Access Denied." });

        const randomString = crypto.randomBytes(3).toString('hex').toUpperCase();
        const newCode = `FLOW-${randomString}`;

        await User.update({ 
            companyCode: newCode,
            codeCreatedAt: new Date(),   
            codeCurrentUsage: 0,         
            codeMaxUsage: 10             
        }, { 
            where: { id: req.user.id } 
        });

        res.json({ companyCode: newCode });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


router.post("/login", async (req, res) => {
    let { email, password, recaptchaToken } = req.body;
    try {
        if (!recaptchaToken) return res.status(400).json({ message: "Security token missing." });

        const user = await User.findOne({ where: { email } });
        if (!user) return res.status(400).json({ message: "Invalid email or password" });

        if (user.isActive === false) {
            return res.status(403).json({ 
                message: "Access Denied: Your account has been suspended." 
            });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(400).json({ message: "Invalid email or password" });

        const token = jwt.sign(
            { id: user.id, email: user.email, role: user.role },
            process.env.APP_SECRET, 
            { expiresIn: '1h' }
        );

        res.json({ 
            token, 
            user: { 
                id: user.id, 
                name: user.name, 
                role: user.role,
                isEnrolled: user.isEnrolled 
            } 
        });

    } catch (err) {
        res.status(500).json({ message: "Internal server error" });
    }
});

router.get("/my-code", authenticateToken, async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id, { 
            attributes: ['companyCode', 'codeCurrentUsage', 'codeMaxUsage', 'codeCreatedAt'] 
        });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get("/my-staff", authenticateToken, async (req, res) => {
    try {
        const myStaff = await User.findAll({
            where: { role: 'Staff', managerId: req.user.id },
            attributes: ['id', 'name', 'email', 'createdAt']
        });
        res.json(myStaff);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get("/", async (req, res) => {
  try {
    const users = await User.findAll({
      attributes: ['id', 'name', 'email', 'role', 'isActive', 'createdAt'],
      include: [{
        model: Attendance,
        as: 'Attendances',
        limit: 1,
        order: [['timestamp', 'DESC']]
      }]
    });

    const userList = users.map(user => {
      const latestScan = user.Attendances[0];
      return {
        ...user.toJSON(),
        locationStatus: latestScan ? (latestScan.type === 'IN' ? 'On-Site' : 'Off-Site') : 'Off-Site'
      };
    });

    res.json(userList);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put("/suspend/:id", authenticateToken, async (req, res) => {
    try {
        if (req.user.role !== 'FM') return res.status(403).json({ message: "Unauthorized." });

        const user = await User.findByPk(req.params.id);
        if (!user) return res.status(404).json({ message: "User not found." });

        await user.update({ isActive: !user.isActive });
        res.json({ message: `User status updated to ${user.isActive ? 'Active' : 'Suspended'}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get("/logs/:id", authenticateToken, async (req, res) => {
    try {
        const logs = await Attendance.findAll({ 
            where: { userId: req.params.id },
            order: [['timestamp', 'DESC']],
            limit: 50
        });
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete("/:id", authenticateToken, async (req, res) => {
    try {
        const staffMember = await User.findByPk(req.params.id);
        if (!staffMember) return res.status(404).json({ message: "Not found." });

        if (req.user.role === 'Tenant' && staffMember.managerId !== req.user.id) {
            return res.status(403).json({ message: "Unauthorized action." });
        }

        await staffMember.destroy();
        res.json({ message: "Removed successfully." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST: /user/enroll-face
router.post('/enroll-face', verifyToken, async (req, res) => {
    try {
        const { images } = req.body;
        
        // This requires your JWT middleware to attach the user ID to req.user
        const userId = req.user.id; 

        console.log(`Starting face enrollment for User ID: ${userId}`);

        // 1. Send the images to the Python AI service
        const pythonResponse = await axios.post('http://127.0.0.1:8000/api/encode-faces', {
            front: images.front,
            left: images.left,
            right: images.right
        });

        const faceVector = pythonResponse.data.vector; // The 512-number array

        // 2. Save to PostgreSQL using Sequelize
        await User.update(
            { 
                faceVector: JSON.stringify(faceVector), 
                isEnrolled: true 
            },
            { 
                where: { id: userId } 
            }
        );

        res.status(200).json({ message: "Biometric enrollment successful" });

    } catch (error) {
        console.error("Enrollment Error:", error.response ? error.response.data : error.message);
        res.status(500).json({ error: "Failed to generate biometric vector." });
    }
});

module.exports = router;