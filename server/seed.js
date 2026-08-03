const bcrypt = require('bcrypt');

const FM_EMAIL = 'admin@harrison.com';
const FM_ROLE = 'FM';
const SEED_PASSWORD_ENV = 'FLOWGUARD_SEED_FM_PASSWORD';
const MIN_PASSWORD_LENGTH = 8;

const validateSeedPassword = (env = process.env) => {
    const configured = env?.[SEED_PASSWORD_ENV];
    if (typeof configured !== 'string' || configured.trim() === '') {
        return {
            ok: false,
            error: `${SEED_PASSWORD_ENV} is required only when explicitly running the initial FM seed command.`
        };
    }

    // A seed-only credential has no existing account value to preserve, so
    // trimming accidental shell/.env whitespace is safe before hashing it.
    const password = configured.trim();
    if (password.length < MIN_PASSWORD_LENGTH) {
        return {
            ok: false,
            error: `${SEED_PASSWORD_ENV} must meet the FlowGuard password policy of at least ${MIN_PASSWORD_LENGTH} characters.`
        };
    }

    return { ok: true, password };
};

const seedFirstAdmin = async ({ User, password, hashPassword = bcrypt.hash }) => {
    const hashedPassword = await hashPassword(password, 10);

    // findOrCreate is deliberately preserved: when the FM already exists, the
    // defaults (including the newly supplied hash) are ignored and no password,
    // role, status, or other account field is reset.
    const [, created] = await User.findOrCreate({
        where: { email: FM_EMAIL },
        defaults: {
            name: 'System Root Admin',
            email: FM_EMAIL,
            password: hashedPassword,
            role: FM_ROLE,
            isActive: true,
            companyCode: 'ROOT-ACCESS-001'
        }
    });

    return { created };
};

const runSeedCommand = async ({
    env = process.env,
    logger = console,
    loadModels = () => require('./models'),
    hashPassword = bcrypt.hash
} = {}) => {
    logger.log('FlowGuard FM seed started.');

    const validation = validateSeedPassword(env);
    if (!validation.ok) {
        logger.error(validation.error);
        return 1;
    }

    let db;
    let exitCode = 0;
    try {
        db = loadModels();
        const { created } = await seedFirstAdmin({
            User: db.User,
            password: validation.password,
            hashPassword
        });
        logger.log(created
            ? 'Initial FM account created.'
            : 'Initial FM account already exists; no account fields were changed.');
        logger.log('FlowGuard FM seed completed.');
    } catch {
        // Deliberately do not echo database errors or credential material.
        logger.error('FlowGuard FM seed failed.');
        exitCode = 1;
    } finally {
        if (db?.sequelize?.close) {
            try {
                await db.sequelize.close();
            } catch {
                logger.error('FlowGuard FM seed cleanup failed.');
                exitCode = 1;
            }
        }
    }

    return exitCode;
};

if (require.main === module) {
    void runSeedCommand().then((exitCode) => {
        process.exitCode = exitCode;
    });
}

module.exports = {
    FM_EMAIL,
    FM_ROLE,
    SEED_PASSWORD_ENV,
    MIN_PASSWORD_LENGTH,
    validateSeedPassword,
    seedFirstAdmin,
    runSeedCommand
};
