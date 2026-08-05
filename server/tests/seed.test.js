const fs = require('fs');
const path = require('path');
const {
  FM_EMAIL,
  FM_ROLE,
  SEED_PASSWORD_ENV,
  MIN_PASSWORD_LENGTH,
  runSeedCommand,
} = require('../seed');

const validPassword = () => ['Valid', 'Seed', 'Credential', '42!'].join('-');

const harness = ({ env = {}, created = true, existingUser = null } = {}) => {
  const storedUser = existingUser || { id: 1, email: FM_EMAIL, role: FM_ROLE, password: 'stored-hash' };
  const User = {
    findOrCreate: jest.fn().mockResolvedValue([storedUser, created]),
  };
  const sequelize = { close: jest.fn().mockResolvedValue() };
  const hashPassword = jest.fn().mockResolvedValue('new-hash');
  const logger = { log: jest.fn(), error: jest.fn() };
  const loadModels = jest.fn(() => ({ User, sequelize }));

  return {
    env,
    User,
    sequelize,
    hashPassword,
    logger,
    loadModels,
    run: () => runSeedCommand({ env, logger, loadModels, hashPassword }),
  };
};

const allLoggedText = (logger) => [
  ...logger.log.mock.calls,
  ...logger.error.mock.calls,
].flat().join(' ');

describe('explicit FM seed credential handling', () => {
  test('rejects a missing seed password without loading models or logging credentials', async () => {
    const test = harness();

    await expect(test.run()).resolves.toBe(1);

    expect(test.loadModels).not.toHaveBeenCalled();
    expect(test.hashPassword).not.toHaveBeenCalled();
    expect(test.logger.error).toHaveBeenCalledWith(expect.stringContaining(SEED_PASSWORD_ENV));
    expect(allLoggedText(test.logger)).not.toMatch(/email|admin@|password\s*:/i);
  });

  test('rejects a value shorter than the current application policy', async () => {
    const test = harness({ env: { [SEED_PASSWORD_ENV]: 'x'.repeat(MIN_PASSWORD_LENGTH - 1) } });

    await expect(test.run()).resolves.toBe(1);

    expect(test.loadModels).not.toHaveBeenCalled();
    expect(test.hashPassword).not.toHaveBeenCalled();
    expect(test.logger.error).toHaveBeenCalledWith(expect.stringMatching(/at least 8 characters/i));
  });

  test('trims, hashes, and passes a valid environment credential only as a hash', async () => {
    const configured = validPassword();
    const test = harness({ env: { [SEED_PASSWORD_ENV]: `  ${configured}  ` } });

    await expect(test.run()).resolves.toBe(0);

    expect(test.hashPassword).toHaveBeenCalledWith(configured, 10);
    expect(test.User.findOrCreate).toHaveBeenCalledWith({
      where: { email: FM_EMAIL },
      defaults: expect.objectContaining({
        name: 'System Root Admin',
        email: FM_EMAIL,
        password: 'new-hash',
        role: FM_ROLE,
        isActive: true,
      }),
    });
    expect(allLoggedText(test.logger)).not.toContain(configured);
    expect(test.sequelize.close).toHaveBeenCalledTimes(1);
  });

  test('does not overwrite or reset an existing FM account', async () => {
    const existing = { id: 1, email: FM_EMAIL, role: FM_ROLE, password: 'existing-hash', isActive: false };
    const test = harness({
      env: { [SEED_PASSWORD_ENV]: validPassword() },
      created: false,
      existingUser: existing,
    });

    await expect(test.run()).resolves.toBe(0);

    expect(existing.password).toBe('existing-hash');
    expect(existing.isActive).toBe(false);
    expect(test.User.findOrCreate).toHaveBeenCalledTimes(1);
    expect(test.logger.log).toHaveBeenCalledWith(expect.stringMatching(/already exists/i));
  });

  test('never prints a valid seed credential to stdout or stderr', async () => {
    const configured = validPassword();
    const test = harness({ env: { [SEED_PASSWORD_ENV]: configured } });

    await test.run();

    expect(allLoggedText(test.logger)).not.toContain(configured);
    expect(allLoggedText(test.logger)).not.toMatch(/credential length|partial password/i);
  });
});

describe('normal server startup wiring', () => {
  test('does not run seed.js or require the seed-only variable', () => {
    const serverRoot = path.resolve(__dirname, '..');
    const indexSource = fs.readFileSync(path.join(serverRoot, 'index.js'), 'utf8');
    const dockerfile = fs.readFileSync(path.join(serverRoot, 'Dockerfile'), 'utf8');
    const packageJson = JSON.parse(fs.readFileSync(path.join(serverRoot, 'package.json'), 'utf8'));

    expect(packageJson.scripts.start).toBe('node index.js');
    expect(dockerfile).toContain('CMD ["node", "index.js"]');
    expect(indexSource).not.toContain("require('./seed')");
    expect(indexSource).not.toContain(SEED_PASSWORD_ENV);
  });
});
