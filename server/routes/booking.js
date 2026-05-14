const express = require('express');
const router = express.Router();
const { Booking } = require('../models');
const axios = require('axios');

// POST: Create a new booking and trigger WhatsApp
router.post('/create', async (req, res) => {
    try {
        const { transport_company, license_plate, driver_phone, loading_bay } = req.body;

        if (!driver_phone) {
            return res.status(400).json({ success: false, message: "Phone number is required" });
        }

        // 1. Clean the phone number
        const cleanPhone = driver_phone.replace(/\D/g, '');

        // 2. Generate a unique reference
        const booking_ref = `FG-${Math.floor(1000 + Math.random() * 9000)}`;
        
        // 3. The URL the driver will click (Use your local IP instead of localhost for mobile testing!)
        const driverPortalUrl = `http://localhost:5173/driver-portal/${booking_ref}`;

        // 4. Save to PostgreSQL
        const newBooking = await Booking.create({
            booking_ref,
            transport_company,
            license_plate,
            driver_phone: cleanPhone,
            loading_bay,
            status: 'Pending'
        });

        // 5. Attempt to send WhatsApp using your CUSTOM template
        try {
            await axios({
                method: 'POST',
                url: `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
                headers: {
                    'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                data: {
                    messaging_product: "whatsapp",
                    to: cleanPhone, 
                    type: "template",
                    template: {
                        name: "driver_booking_link", // Must match your approved Meta template name
                        language: { code: "en_US" },
                        components: [
                            {
                                type: "body",
                                parameters: [
                                    {
                                        type: "text",
                                        text: driverPortalUrl // This replaces {{1}} in your template
                                    }
                                ]
                            }
                        ]
                    }
                }
            });
            console.log(`✅ Custom WhatsApp sent to ${cleanPhone}`);
        } catch (whatsappError) {
            console.error("❌ WhatsApp failed:", whatsappError.response ? whatsappError.response.data : whatsappError.message);
        }

        res.status(201).json({
            success: true,
            message: "Booking saved! Check console for WhatsApp status.",
            data: newBooking,
            link: driverPortalUrl
        });

    } catch (error) {
        console.error("Critical Booking Error:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});

// GET: Fetch details for the Driver Portal
router.get('/:ref', async (req, res) => {
    try {
        const booking = await Booking.findOne({ where: { booking_ref: req.params.ref } });
        if (!booking) return res.status(404).json({ message: "Booking not found" });
        res.json(booking);
    } catch (error) {
        res.status(500).json({ message: "Error fetching booking" });
    }
});

// GET: Fetch all active bookings for the dashboard
router.get('/all', async (req, res) => {
    try {
        const allBookings = await Booking.findAll({
            order: [['createdAt', 'DESC']], // Newest first
            limit: 10 // Only show the last 10
        });
        res.json(allBookings);
    } catch (error) {
        console.error("Fetch Error:", error);
        res.status(500).json({ message: "Error fetching bookings" });
    }
});

module.exports = router;