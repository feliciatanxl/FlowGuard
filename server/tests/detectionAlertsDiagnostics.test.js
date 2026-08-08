const request = require('supertest');
const express = require('express');

// Mock dependencies before requiring detectionAlerts route
jest.mock('../models', () => {
  const alertStore = [];
  let nextId = 1;

  class FakeAlert {
    constructor(data) {
      Object.assign(this, data);
      this.id = data.id || nextId++;
      this.status = data.status || 'Active';
      this.whatsapp_status = data.whatsapp_status || 'Not Requested';
      this.whatsapp_error = data.whatsapp_error || null;
    }
    static async create(data) {
      const record = new FakeAlert(data);
      alertStore.push(record);
      return record;
    }
    static async findOne() { return null; }
    static async findByPk(id) { return alertStore.find(a => String(a.id) === String(id)) || null; }
    static async findAll() { return [...alertStore]; }
    async update(changes) {
      Object.assign(this, changes);
      return this;
    }
  }

  class FakeIncident {
    constructor(data) {
      Object.assign(this, data);
      this.id = 100;
    }
    static async create(data) { return new FakeIncident(data); }
  }

  return {
    DetectionAlert: FakeAlert,
    IncidentLog: FakeIncident,
    MonitoringZone: { findOne: jest.fn().mockResolvedValue(null) },
    Camera: { findOne: jest.fn().mockResolvedValue(null) },
    sequelize: { transaction: (fn) => fn(null) },
  };
});

jest.mock('../services/whatsappService', () => {
  const actual = jest.requireActual('../services/whatsappService');
  return {
    ...actual,
    sendDetectionAlert: jest.fn().mockImplementation(async (alert) => {
      if (process.env.TEST_WA_FAIL === 'true') {
        return { status: 'Failed', error: 'Meta API 500 Internal Error' };
      }
      if (process.env.WHATSAPP_ENABLED === 'true') {
        return { status: 'Sent', error: null };
      }
      return { status: 'Simulated', error: null };
    }),
  };
});

const detectionAlertsRouter = require('../routes/detectionAlerts');

const app = express();
app.use(express.json());
app.use('/api/detection-alerts', detectionAlertsRouter);

describe('Detection Alerts & WhatsApp Safe Diagnostics', () => {
  const originalEnv = { ...process.env };
  let consoleSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.AI_SERVICE_KEY = 'test-secret-key-123';
    consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    consoleSpy.mockRestore();
  });

  test('Logs disabled by detection-alert switch when WHATSAPP_DETECTION_ALERTS_ENABLED is not true', async () => {
    process.env.WHATSAPP_DETECTION_ALERTS_ENABLED = 'false';

    const res = await request(app)
      .post('/api/detection-alerts')
      .set('x-service-key', 'test-secret-key-123')
      .send({
        zone_name: 'Zone A',
        camera_location: 'Storage Cam 01',
        alert_type: 'RESTRICTED_MOTION',
        severity: 'Critical',
      });

    expect(res.status).toBe(201);
    expect(res.body.whatsapp_status).toBe('Not Requested');
    expect(consoleSpy).toHaveBeenCalledWith('[WhatsApp][Detection] disabled by detection-alert switch');
  });

  test('Logs no security recipients configured when WHATSAPP_SECURITY_RECIPIENTS is empty', async () => {
    process.env.WHATSAPP_DETECTION_ALERTS_ENABLED = 'true';
    delete process.env.WHATSAPP_SECURITY_RECIPIENTS;

    const res = await request(app)
      .post('/api/detection-alerts')
      .set('x-service-key', 'test-secret-key-123')
      .send({
        zone_name: 'Zone A',
        camera_location: 'Storage Cam 01',
        alert_type: 'RESTRICTED_MOTION',
        severity: 'Critical',
      });

    expect(res.status).toBe(201);
    expect(res.body.whatsapp_status).toBe('Skipped');
    expect(res.body.whatsapp_error).toContain('No security recipients configured');
    expect(consoleSpy).toHaveBeenCalledWith('[WhatsApp][Detection] no security recipients configured');
  });

  test('Logs below minimum severity when alert severity is lower than floor', async () => {
    process.env.WHATSAPP_DETECTION_ALERTS_ENABLED = 'true';
    process.env.WHATSAPP_SECURITY_RECIPIENTS = '+6591234567';
    process.env.WHATSAPP_DETECTION_MIN_SEVERITY = 'High';

    const res = await request(app)
      .post('/api/detection-alerts')
      .set('x-service-key', 'test-secret-key-123')
      .send({
        zone_name: 'Zone A',
        camera_location: 'Storage Cam 01',
        alert_type: 'UNATTENDED_OBJECT',
        severity: 'Low',
      });

    expect(res.status).toBe(201);
    expect(res.body.whatsapp_status).toBe('Skipped');
    expect(consoleSpy).toHaveBeenCalledWith('[WhatsApp][Detection] below minimum severity');
  });

  test('Logs simulated when WhatsApp Cloud API is in mock mode (WHATSAPP_ENABLED is not true)', async () => {
    process.env.WHATSAPP_DETECTION_ALERTS_ENABLED = 'true';
    process.env.WHATSAPP_SECURITY_RECIPIENTS = '+6591234567';
    process.env.WHATSAPP_ENABLED = 'false';

    const res = await request(app)
      .post('/api/detection-alerts')
      .set('x-service-key', 'test-secret-key-123')
      .send({
        zone_name: 'Zone A',
        camera_location: 'Storage Cam 01',
        alert_type: 'RESTRICTED_MOTION',
        severity: 'Critical',
      });

    expect(res.status).toBe(201);
    expect(res.body.whatsapp_status).toBe('Simulated');
    expect(consoleSpy).toHaveBeenCalledWith('[WhatsApp][Detection] simulated');
  });

  test('Logs sent when WhatsApp Cloud API delivery succeeds', async () => {
    process.env.WHATSAPP_DETECTION_ALERTS_ENABLED = 'true';
    process.env.WHATSAPP_SECURITY_RECIPIENTS = '+6591234567';
    process.env.WHATSAPP_ENABLED = 'true';

    const res = await request(app)
      .post('/api/detection-alerts')
      .set('x-service-key', 'test-secret-key-123')
      .send({
        zone_name: 'Zone A',
        camera_location: 'Storage Cam 01',
        alert_type: 'RESTRICTED_MOTION',
        severity: 'Critical',
      });

    expect(res.status).toBe(201);
    expect(res.body.whatsapp_status).toBe('Sent');
    expect(consoleSpy).toHaveBeenCalledWith('[WhatsApp][Detection] sent');
  });

  test('Logs safe failure message when provider fails without leaking secrets', async () => {
    process.env.WHATSAPP_DETECTION_ALERTS_ENABLED = 'true';
    process.env.WHATSAPP_SECURITY_RECIPIENTS = '+6591234567';
    process.env.WHATSAPP_ENABLED = 'true';
    process.env.TEST_WA_FAIL = 'true';

    const res = await request(app)
      .post('/api/detection-alerts')
      .set('x-service-key', 'test-secret-key-123')
      .send({
        zone_name: 'Zone A',
        camera_location: 'Storage Cam 01',
        alert_type: 'RESTRICTED_MOTION',
        severity: 'Critical',
      });

    expect(res.status).toBe(201);
    expect(res.body.whatsapp_status).toBe('Failed');
    expect(res.body.whatsapp_error).toBe('Meta API 500 Internal Error');
    expect(consoleSpy).toHaveBeenCalledWith('[WhatsApp][Detection] failed: Meta API 500 Internal Error');
  });
});
