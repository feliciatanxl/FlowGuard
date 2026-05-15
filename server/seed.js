const { User } = require('./models'); // Adjust path if your models folder is elsewhere
const bcrypt = require('bcrypt');

/**
 * SEED SCRIPT: Creates the initial Facilities Manager (FM)
 * Run this command in your terminal: node seed.js
 */
const seedFirstAdmin = async () => {
    try {
        console.log("--- Starting FlowGuard System Bootstrap ---");

        // 1. Define the Master Admin Credentials
        const adminEmail = 'admin@harrison.com';
        const adminPassword = 'Admin123!'; // Your team can change this after logging in
        const hashedPassword = await bcrypt.hash(adminPassword, 10);

        // 2. Use findOrCreate to prevent duplicates
        const [user, created] = await User.findOrCreate({
            where: { email: adminEmail },
            defaults: {
                name: 'System Root Admin',
                email: adminEmail,
                password: hashedPassword,
                role: 'FM',
                isActive: true,
                companyCode: 'ROOT-ACCESS-001' // Optional internal identifier
            }
        });

        if (created) {
            console.log("\n✅ SUCCESS: Initial FM created.");
            console.log("------------------------------------------");
            console.log(`Email:    ${adminEmail}`);
            console.log(`Password: ${adminPassword}`);
            console.log("------------------------------------------");
            console.log("You can now log in at the /login page.");
        } else {
            console.log("\nℹ️  INFO: Admin account already exists in the database.");
        }

        process.exit(0); // Exit successfully
    } catch (err) {
        console.error("\n❌ ERROR: Failed to seed admin user.");
        console.error(err.message);
        process.exit(1); // Exit with error
    }
};

// Execute the function
seedFirstAdmin();