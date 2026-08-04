const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const mockChatTranscript = { findOrCreate: jest.fn(), findOne: jest.fn(), destroy: jest.fn() };
const mockSupportTicket = { create: jest.fn(), findOne: jest.fn(), findAndCountAll: jest.fn(), count: jest.fn(), findByPk: jest.fn() };
const mockKnowledgeBase = { findAll: jest.fn(), create: jest.fn(), findByPk: jest.fn() };
const mockUser = { findByPk: jest.fn() };
const mockIncidentLog = { findByPk: jest.fn() };
// Pass-through transaction mock: just invokes the callback with a fake
// transaction handle and returns whatever it resolves to, matching the real
// sequelize.transaction(async (t) => {...}) contract closely enough for these
// unit tests (the transaction boundary itself isn't what's under test here).
const mockSequelize = { transaction: jest.fn((cb) => cb({})), query: jest.fn() };

// No User model in this mock — verifyToken's DB re-read is lazily required and
// falls back to trusting the JWT payload's role when User is absent (see
// middlewares/auth.js). That's the right level of isolation here: Module 3's
// tests exercise support.js/supportService.js, not the shared auth system.
// User IS included for support.js's own optional-identity-verification path.
jest.mock('../models', () => ({
  ChatTranscript: mockChatTranscript,
  SupportTicket: mockSupportTicket,
  KnowledgeBase: mockKnowledgeBase,
  User: mockUser,
  IncidentLog: mockIncidentLog,
  sequelize: mockSequelize
}));

// Mocked separately from the models above so each test controls whether
// Gemini "succeeds" or is "unavailable" independently of the DB mocks.
const mockGenerateChatReply = jest.fn();
const mockGenerateStatusMessage = jest.fn();
jest.mock('../services/geminiService', () => ({
  generateChatReply: (...args) => mockGenerateChatReply(...args),
  generateStatusMessage: (...args) => mockGenerateStatusMessage(...args)
}));

process.env.APP_SECRET = 'test-secret';

const supportRouter = require('../routes/support');
const app = express();
app.use(express.json());
app.use('/api/support', supportRouter);

const tokenFor = (role, id = 1) => jwt.sign({ id, role, tokenVersion: 0 }, process.env.APP_SECRET);
const fmAuth = { Authorization: `Bearer ${tokenFor('FM')}` };

// Every id in this feature is a UUID column — fixed fake UUIDs so tests don't
// trip the new format validation while still reading as distinct fixtures.
const SESSION_ID = '11111111-1111-1111-1111-111111111111';
const TRANSCRIPT_ID = '22222222-2222-2222-2222-222222222222';
const TICKET_ID = '33333333-3333-3333-3333-333333333333';
const MISSING_ID = '99999999-9999-9999-9999-999999999999';

const makeTranscript = (overrides = {}) => ({
  id: TRANSCRIPT_ID,
  sessionId: SESSION_ID,
  userId: null,
  tenantName: null,
  unitNumber: null,
  messages: [],
  isEscalated: false,
  escalationReason: null,
  update: jest.fn().mockResolvedValue(true),
  ...overrides
});

beforeEach(() => {
  jest.clearAllMocks();
  mockKnowledgeBase.findAll.mockResolvedValue([]);
  mockSupportTicket.findOne.mockResolvedValue(null);
  mockSequelize.query.mockResolvedValue([]);
  mockSequelize.transaction.mockImplementation((cb) => cb({}));
  // Default: Gemini "unavailable" (mirrors real behavior with no API key
  // configured), so every existing non-escalating test keeps exercising the
  // deterministic keyword-match fallback unless it explicitly opts Gemini in.
  mockGenerateChatReply.mockRejectedValue(new Error('GEMINI_API_KEY is not configured.'));
  // Same default as above — existing escalation/already-tracked tests assert
  // on the fixed fallback text, so status-message generation "fails" unless a
  // test explicitly opts it in.
  mockGenerateStatusMessage.mockRejectedValue(new Error('GEMINI_API_KEY is not configured.'));
  // Default DB-authoritative account for verifyToken's re-read AND support.js's
  // own resolveVerifiedIdentity: id 50/60 are the "non-FM" convention used
  // below (matching the id->role mapping already used by dashboard.test.js),
  // everything else resolves as an active FM account. clearAllMocks() does
  // NOT reset a previous mockResolvedValue/mockImplementation, so this has to
  // be re-established every test — otherwise a later test's one-off override
  // (e.g. the identity-verification tests below) would leak into every test
  // that runs after it.
  mockUser.findByPk.mockImplementation((id) => Promise.resolve({
    id: Number(id),
    role: Number(id) === 50 ? 'Tenant' : Number(id) === 60 ? 'Staff' : 'FM',
    name: 'Test Account',
    isActive: true,
    tokenVersion: 0
  }));
});

describe('POST /api/support/chat', () => {
  test('rejects a request missing sessionId or message', async () => {
    const res = await request(app).post('/api/support/chat').send({ sessionId: SESSION_ID });
    expect(res.status).toBe(400);
  });

  test('rejects a malformed sessionId', async () => {
    const res = await request(app).post('/api/support/chat').send({ sessionId: 'not-a-uuid', message: 'hi' });
    expect(res.status).toBe(400);
  });

  test('rejects an over-long message', async () => {
    const res = await request(app).post('/api/support/chat').send({ sessionId: SESSION_ID, message: 'a'.repeat(2001) });
    expect(res.status).toBe(400);
  });

  test('answers from the knowledge base when a confident match exists', async () => {
    const transcript = makeTranscript();
    mockChatTranscript.findOrCreate.mockResolvedValue([transcript, true]);
    mockKnowledgeBase.findAll.mockResolvedValue([{
      category: 'Access Control',
      question: 'Why does my face scan keep failing?',
      answer: 'Try re-enrolling your face in good lighting.',
      keywords: ['face', 'scan', 'biometric', 'access']
    }]);

    const res = await request(app).post('/api/support/chat').send({
      sessionId: SESSION_ID,
      message: 'my face scan keeps failing at the gate'
    });

    expect(res.status).toBe(200);
    expect(res.body.response).toBe('Try re-enrolling your face in good lighting.');
    expect(res.body.escalated).toBe(false);
    expect(mockSupportTicket.create).not.toHaveBeenCalled();
  });

  test('uses the Gemini-generated reply when the API call succeeds', async () => {
    const transcript = makeTranscript();
    mockChatTranscript.findOrCreate.mockResolvedValue([transcript, true]);
    mockGenerateChatReply.mockResolvedValue('Gemini says: try re-enrolling in better lighting.');

    const res = await request(app).post('/api/support/chat').send({
      sessionId: SESSION_ID,
      message: 'my face scan keeps failing'
    });

    expect(res.status).toBe(200);
    expect(res.body.response).toBe('Gemini says: try re-enrolling in better lighting.');
    expect(mockGenerateChatReply).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'my face scan keeps failing' })
    );
  });

  test('falls back to the generic prompt when Gemini fails and no KB entry matches', async () => {
    const transcript = makeTranscript();
    mockChatTranscript.findOrCreate.mockResolvedValue([transcript, true]);
    // mockGenerateChatReply already rejects by default (see beforeEach); no KB entries either.

    const res = await request(app).post('/api/support/chat').send({
      sessionId: SESSION_ID,
      message: 'something odd is happening with my unit'
    });

    expect(res.status).toBe(200);
    expect(res.body.response).toMatch(/could you provide more details/i);
  });

  test('does NOT escalate on a trigger word on the very first message of a session', async () => {
    const transcript = makeTranscript(); // messages: [] — this is message #1
    mockChatTranscript.findOrCreate.mockResolvedValue([transcript, true]);

    const res = await request(app).post('/api/support/chat').send({
      sessionId: SESSION_ID,
      message: 'this is urgent, please help'
    });

    expect(res.status).toBe(200);
    expect(res.body.escalated).toBe(false);
    expect(mockSupportTicket.create).not.toHaveBeenCalled();
  });

  test('auto-escalates on a trigger phrase from the second message onward, with an inferred category', async () => {
    const transcript = makeTranscript({
      messages: [{ role: 'user', text: 'my face scan is not working', timestamp: 'now' }]
    });
    mockChatTranscript.findOrCreate.mockResolvedValue([transcript, false]);
    mockSupportTicket.create.mockResolvedValue({ id: 'ticket-123456789' });

    const res = await request(app).post('/api/support/chat').send({
      sessionId: SESSION_ID,
      message: 'the gate is still not working and my face scan keeps failing',
      tenantName: 'Acme Corp',
      unitNumber: '01-23'
    });

    expect(res.status).toBe(200);
    expect(res.body.escalated).toBe(true);
    expect(res.body.ticketId).toBe('TICKET-1');
    expect(mockSupportTicket.create).toHaveBeenCalledTimes(1);
    const created = mockSupportTicket.create.mock.calls[0][0];
    expect(created.priority).toBe('High');
    expect(created.status).toBe('Pending');
    expect(created.category).toBe('Access Control');
    expect(transcript.update).toHaveBeenCalledWith(expect.objectContaining({ isEscalated: true }), expect.anything());
    expect(mockSequelize.transaction).toHaveBeenCalled();
  });

  test('phrases the escalation confirmation via Gemini when available, still with the correct ticket id and deterministic decision', async () => {
    const transcript = makeTranscript({
      messages: [{ role: 'user', text: 'my face scan is not working', timestamp: 'now' }]
    });
    mockChatTranscript.findOrCreate.mockResolvedValue([transcript, false]);
    mockSupportTicket.create.mockResolvedValue({ id: 'ticket-123456789' });
    mockGenerateStatusMessage.mockResolvedValue("Good news — I've escalated this to FM, ticket TICKET-1. They'll be in touch soon!");

    const res = await request(app).post('/api/support/chat').send({
      sessionId: SESSION_ID,
      message: 'the gate is still not working and my face scan keeps failing'
    });

    expect(res.status).toBe(200);
    expect(res.body.escalated).toBe(true); // decision is unaffected by Gemini
    expect(res.body.ticketId).toBe('TICKET-1'); // ticket id is unaffected by Gemini
    expect(res.body.response).toBe("Good news — I've escalated this to FM, ticket TICKET-1. They'll be in touch soon!");
    expect(mockGenerateStatusMessage).toHaveBeenCalledWith(
      expect.objectContaining({ situation: expect.stringContaining('TICKET-1') })
    );
  });

  test('auto-escalates after five user messages even without a trigger phrase', async () => {
    const transcript = makeTranscript({
      messages: Array.from({ length: 4 }, (_, i) => ({ role: 'user', text: `msg ${i}`, timestamp: 'now' }))
    });
    mockChatTranscript.findOrCreate.mockResolvedValue([transcript, false]);
    mockSupportTicket.create.mockResolvedValue({ id: 'ticket-987654321' });

    const res = await request(app).post('/api/support/chat').send({
      sessionId: SESSION_ID,
      message: 'ok one more try'
    });

    expect(res.body.escalated).toBe(true);
    expect(mockSupportTicket.create).toHaveBeenCalledTimes(1);
  });

  test('an already-escalated session gets a canned reply and no duplicate ticket', async () => {
    const transcript = makeTranscript({ isEscalated: true });
    mockChatTranscript.findOrCreate.mockResolvedValue([transcript, false]);

    const res = await request(app).post('/api/support/chat').send({
      sessionId: SESSION_ID,
      message: 'any update?'
    });

    expect(res.status).toBe(200);
    expect(res.body.escalated).toBe(false); // already escalated before this turn — not newly escalated
    expect(res.body.response).toMatch(/already being tracked/i);
    expect(mockSupportTicket.create).not.toHaveBeenCalled();
  });

  test('phrases the "already tracked" reply via Gemini when available', async () => {
    const transcript = makeTranscript({ isEscalated: true });
    mockChatTranscript.findOrCreate.mockResolvedValue([transcript, false]);
    mockGenerateStatusMessage.mockResolvedValue("Just a heads up — FM already has this one, they'll reach out soon!");

    const res = await request(app).post('/api/support/chat').send({
      sessionId: SESSION_ID,
      message: 'any update?'
    });

    expect(res.status).toBe(200);
    expect(res.body.response).toBe("Just a heads up — FM already has this one, they'll reach out soon!");
    expect(mockSupportTicket.create).not.toHaveBeenCalled();
  });

  test('a valid bearer token overrides the client-supplied tenant identity', async () => {
    const transcript = makeTranscript();
    mockChatTranscript.findOrCreate.mockResolvedValue([transcript, true]);
    mockUser.findByPk.mockResolvedValue({ id: 42, name: 'Real Tenant Pte Ltd', isActive: true });

    await request(app)
      .post('/api/support/chat')
      .set('Authorization', `Bearer ${tokenFor('Tenant', 42)}`)
      .send({ sessionId: SESSION_ID, message: 'hello', tenantName: 'Spoofed CEO Office' });

    const findOrCreateArgs = mockChatTranscript.findOrCreate.mock.calls[0][0];
    expect(findOrCreateArgs.defaults.tenantName).toBe('Real Tenant Pte Ltd');
    expect(findOrCreateArgs.defaults.userId).toBe(42);
  });

  test('an invalid bearer token is ignored and the request proceeds anonymously', async () => {
    const transcript = makeTranscript();
    mockChatTranscript.findOrCreate.mockResolvedValue([transcript, true]);

    const res = await request(app)
      .post('/api/support/chat')
      .set('Authorization', 'Bearer not-a-real-token')
      .send({ sessionId: SESSION_ID, message: 'hello', tenantName: 'Anon Co' });

    expect(res.status).toBe(200);
    const findOrCreateArgs = mockChatTranscript.findOrCreate.mock.calls[0][0];
    expect(findOrCreateArgs.defaults.tenantName).toBe('Anon Co');
  });
});

describe('GET /api/support/chat/:sessionId', () => {
  test('rejects a malformed session id', async () => {
    const res = await request(app).get('/api/support/chat/not-a-uuid');
    expect(res.status).toBe(400);
  });

  test('returns an empty history for an unknown session rather than 404', async () => {
    mockChatTranscript.findOne.mockResolvedValue(null);
    const res = await request(app).get(`/api/support/chat/${SESSION_ID}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ messages: [], escalated: false, ticketId: null });
  });

  test('returns stored messages and the linked ticket id when escalated', async () => {
    mockChatTranscript.findOne.mockResolvedValue({
      messages: [{ role: 'user', text: 'hi', timestamp: 'now' }],
      isEscalated: true,
      ticket: { id: 'ticket-abcdef123' }
    });

    const res = await request(app).get(`/api/support/chat/${SESSION_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.escalated).toBe(true);
    expect(res.body.ticketId).toBe('TICKET-A');
  });
});

describe('GET /api/support/tickets', () => {
  test('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/support/tickets');
    expect(res.status).toBe(401);
  });

  test('rejects non-FM roles', async () => {
    const res = await request(app).get('/api/support/tickets').set('Authorization', `Bearer ${tokenFor('Tenant', 50)}`);
    expect(res.status).toBe(403);
  });

  test('returns a paginated shape and defaults to the active (non-archived) queue', async () => {
    mockSupportTicket.findAndCountAll.mockResolvedValue({ rows: [{ id: TICKET_ID }], count: 1 });

    const res = await request(app).get('/api/support/tickets').set(fmAuth);

    expect(res.status).toBe(200);
    expect(res.body.tickets).toHaveLength(1);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 20, total: 1, totalPages: 1 });
    const queryArgs = mockSupportTicket.findAndCountAll.mock.calls[0][0];
    expect(queryArgs.where.isArchived).toBe(false);
  });

  test('applies search, category and archived query params', async () => {
    mockSupportTicket.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

    await request(app)
      .get('/api/support/tickets?q=scan&category=Access%20Control&archived=true&page=2&limit=5')
      .set(fmAuth);

    const queryArgs = mockSupportTicket.findAndCountAll.mock.calls[0][0];
    expect(queryArgs.where.isArchived).toBe(true);
    expect(queryArgs.where.category).toBe('Access Control');
    expect(queryArgs.limit).toBe(5);
    expect(queryArgs.offset).toBe(5); // page 2 at limit 5
  });
});

describe('POST /api/support/tickets', () => {
  test('rejects unauthenticated requests', async () => {
    const res = await request(app).post('/api/support/tickets').send({ issueTitle: 'x', issueDescription: 'y' });
    expect(res.status).toBe(401);
  });

  test('rejects non-FM roles', async () => {
    const res = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', `Bearer ${tokenFor('Tenant', 50)}`)
      .send({ issueTitle: 'x', issueDescription: 'y' });
    expect(res.status).toBe(403);
  });

  test('requires issueTitle and issueDescription', async () => {
    const res = await request(app).post('/api/support/tickets').set(fmAuth).send({ issueTitle: 'Only a title' });
    expect(res.status).toBe(400);
  });

  test('rejects an invalid priority', async () => {
    const res = await request(app)
      .post('/api/support/tickets')
      .set(fmAuth)
      .send({ issueTitle: 'x', issueDescription: 'y', priority: 'Critical' });
    expect(res.status).toBe(400);
  });

  test('creates a manual ticket with no linked transcript, defaulting category/priority', async () => {
    mockSupportTicket.create.mockResolvedValue({ id: TICKET_ID, status: 'Pending' });

    const res = await request(app)
      .post('/api/support/tickets')
      .set(fmAuth)
      .send({ issueTitle: 'Incident #1 escalated: Gate A', issueDescription: 'Escalated from Incident #1.', category: 'Security', priority: 'High', tenantName: 'Charlie Kirk' });

    expect(res.status).toBe(201);
    const created = mockSupportTicket.create.mock.calls[0][0];
    expect(created.category).toBe('Security');
    expect(created.priority).toBe('High');
    expect(created.status).toBe('Pending');
    expect(created.tenantName).toBe('Charlie Kirk');
    expect(created.transcriptId).toBeUndefined();
  });

  test('defaults category to General and priority to Medium when omitted', async () => {
    mockSupportTicket.create.mockResolvedValue({ id: TICKET_ID, status: 'Pending' });

    await request(app).post('/api/support/tickets').set(fmAuth).send({ issueTitle: 'x', issueDescription: 'y' });

    const created = mockSupportTicket.create.mock.calls[0][0];
    expect(created.category).toBe('General');
    expect(created.priority).toBe('Medium');
  });

  test('creates one authoritative support ticket from an incident', async () => {
    mockIncidentLog.findByPk.mockResolvedValue({
      id: 42,
      camera_location: 'Cold Store B',
      status: 'UNAUTHORIZED_ACCESS',
      source: 'Facial Recognition',
      severity: 'Critical',
      notes: 'Unknown person at the restricted entrance.'
    });
    mockSupportTicket.create.mockResolvedValue({ id: TICKET_ID, status: 'Pending' });

    const res = await request(app)
      .post('/api/support/tickets')
      .set(fmAuth)
      .send({ sourceIncidentId: 42 });

    expect(res.status).toBe(201);
    expect(res.body.duplicate).toBe(false);
    expect(mockIncidentLog.findByPk).toHaveBeenCalledWith(42);
    expect(mockSequelize.query).toHaveBeenCalledWith(expect.stringContaining('pg_advisory_xact_lock'), expect.objectContaining({ transaction: expect.anything() }));
    expect(mockSupportTicket.create).toHaveBeenCalledWith(expect.objectContaining({
      issueTitle: 'Incident #42: Cold Store B',
      category: 'Security Incident',
      priority: 'High',
      status: 'Pending'
    }), expect.objectContaining({ transaction: expect.anything() }));
    expect(mockSupportTicket.create.mock.calls[0][0].issueDescription).toContain('FlowGuard Incident #42');
  });

  test('reuses the existing ticket for a repeated incident escalation', async () => {
    const existing = { id: TICKET_ID, issueTitle: 'Incident #42: Cold Store B' };
    mockIncidentLog.findByPk.mockResolvedValue({ id: 42, camera_location: 'Cold Store B', severity: 'High', notes: '' });
    mockSupportTicket.findOne.mockResolvedValue(existing);

    const res = await request(app)
      .post('/api/support/tickets')
      .set(fmAuth)
      .send({ sourceIncidentId: 42 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ duplicate: true, ticket: existing });
    expect(mockSupportTicket.create).not.toHaveBeenCalled();
  });
});

describe('GET /api/support/tickets/stats', () => {
  test('returns aggregate counts scoped to the active queue', async () => {
    mockSupportTicket.count
      .mockResolvedValueOnce(10) // total
      .mockResolvedValueOnce(4)  // highPriority
      .mockResolvedValueOnce(3)  // investigating
      .mockResolvedValueOnce(2); // resolved

    const res = await request(app).get('/api/support/tickets/stats').set(fmAuth);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total: 10, highPriority: 4, investigating: 3, resolved: 2 });
    for (const call of mockSupportTicket.count.mock.calls) {
      expect(call[0].where.isArchived).toBe(false);
    }
  });
});

describe('GET /api/support/tickets/:id', () => {
  test('rejects a malformed ticket id with 400, not a 500', async () => {
    const res = await request(app).get('/api/support/tickets/not-a-uuid').set(fmAuth);
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/support/tickets/:id/status', () => {
  test('rejects a malformed ticket id', async () => {
    const res = await request(app).patch('/api/support/tickets/not-a-uuid/status').set(fmAuth).send({ status: 'Resolved' });
    expect(res.status).toBe(400);
  });

  test('rejects an invalid status', async () => {
    const res = await request(app).patch(`/api/support/tickets/${TICKET_ID}/status`).set(fmAuth).send({ status: 'In Progress' });
    expect(res.status).toBe(400);
  });

  test('404s when the ticket does not exist', async () => {
    mockSupportTicket.findByPk.mockResolvedValue(null);
    const res = await request(app).patch(`/api/support/tickets/${MISSING_ID}/status`).set(fmAuth).send({ status: 'Investigating' });
    expect(res.status).toBe(404);
  });

  test('stamps resolvedBy/resolvedAt when marking Resolved', async () => {
    const ticket = { id: TICKET_ID, update: jest.fn().mockResolvedValue(true) };
    mockSupportTicket.findByPk.mockResolvedValue(ticket);

    const res = await request(app).patch(`/api/support/tickets/${TICKET_ID}/status`).set(fmAuth).send({ status: 'Resolved' });

    expect(res.status).toBe(200);
    const update = ticket.update.mock.calls[0][0];
    expect(update.status).toBe('Resolved');
    expect(update.resolvedAt).toBeInstanceOf(Date);
  });

  test('clears resolvedBy/resolvedAt when a resolved ticket is reopened', async () => {
    const ticket = { id: TICKET_ID, status: 'Resolved', resolvedBy: 'FM #1', update: jest.fn().mockResolvedValue(true) };
    mockSupportTicket.findByPk.mockResolvedValue(ticket);

    const res = await request(app).patch(`/api/support/tickets/${TICKET_ID}/status`).set(fmAuth).send({ status: 'Investigating' });

    expect(res.status).toBe(200);
    const update = ticket.update.mock.calls[0][0];
    expect(update.status).toBe('Investigating');
    expect(update.resolvedBy).toBeNull();
    expect(update.resolvedAt).toBeNull();
  });

  test('accepts an updated category alongside status', async () => {
    const ticket = { id: TICKET_ID, update: jest.fn().mockResolvedValue(true) };
    mockSupportTicket.findByPk.mockResolvedValue(ticket);

    await request(app).patch(`/api/support/tickets/${TICKET_ID}/status`).set(fmAuth).send({ status: 'Pending', category: 'Loading Bay' });

    const update = ticket.update.mock.calls[0][0];
    expect(update.category).toBe('Loading Bay');
  });
});

describe('PATCH /api/support/tickets/:id/archive', () => {
  test('rejects a malformed ticket id', async () => {
    const res = await request(app).patch('/api/support/tickets/not-a-uuid/archive').set(fmAuth).send({ archived: true });
    expect(res.status).toBe(400);
  });

  test('requires a boolean archived flag', async () => {
    const res = await request(app).patch(`/api/support/tickets/${TICKET_ID}/archive`).set(fmAuth).send({ archived: 'yes' });
    expect(res.status).toBe(400);
  });

  test('404s when the ticket does not exist', async () => {
    mockSupportTicket.findByPk.mockResolvedValue(null);
    const res = await request(app).patch(`/api/support/tickets/${MISSING_ID}/archive`).set(fmAuth).send({ archived: true });
    expect(res.status).toBe(404);
  });

  test('archives and restores', async () => {
    const ticket = { id: TICKET_ID, update: jest.fn().mockResolvedValue(true) };
    mockSupportTicket.findByPk.mockResolvedValue(ticket);

    const res = await request(app).patch(`/api/support/tickets/${TICKET_ID}/archive`).set(fmAuth).send({ archived: true });

    expect(res.status).toBe(200);
    expect(ticket.update).toHaveBeenCalledWith({ isArchived: true });
  });
});

describe('DELETE /api/support/tickets/:id', () => {
  test('rejects a malformed ticket id', async () => {
    const res = await request(app).delete('/api/support/tickets/not-a-uuid').set(fmAuth);
    expect(res.status).toBe(400);
  });

  test('deletes the ticket and its linked transcript inside one transaction', async () => {
    const ticket = { id: TICKET_ID, transcriptId: TRANSCRIPT_ID, destroy: jest.fn().mockResolvedValue(true) };
    mockSupportTicket.findByPk.mockResolvedValue(ticket);

    const res = await request(app).delete(`/api/support/tickets/${TICKET_ID}`).set(fmAuth);

    expect(res.status).toBe(200);
    expect(mockSequelize.transaction).toHaveBeenCalled();
    expect(ticket.destroy).toHaveBeenCalled();
    expect(mockChatTranscript.destroy).toHaveBeenCalledWith(expect.objectContaining({ where: { id: TRANSCRIPT_ID } }));
  });

  test('404s when the ticket does not exist', async () => {
    mockSupportTicket.findByPk.mockResolvedValue(null);
    const res = await request(app).delete(`/api/support/tickets/${MISSING_ID}`).set(fmAuth);
    expect(res.status).toBe(404);
  });
});

describe('Knowledge base CRUD', () => {
  test('GET /knowledge is public and applies category/search filters', async () => {
    mockKnowledgeBase.findAll.mockResolvedValue([{ id: 'kb1' }]);

    const res = await request(app).get('/api/support/knowledge?category=Loading%20Bay&q=truck');

    expect(res.status).toBe(200);
    const queryArgs = mockKnowledgeBase.findAll.mock.calls[0][0];
    expect(queryArgs.where.category).toBe('Loading Bay');
  });

  test('POST /knowledge requires FM auth and question/answer', async () => {
    const unauth = await request(app).post('/api/support/knowledge').send({ question: 'Q', answer: 'A' });
    expect(unauth.status).toBe(401);

    const missingFields = await request(app).post('/api/support/knowledge').set(fmAuth).send({ question: '' });
    expect(missingFields.status).toBe(400);

    mockKnowledgeBase.create.mockResolvedValue({ id: 'kb1' });
    const ok = await request(app).post('/api/support/knowledge').set(fmAuth).send({ question: 'Q?', answer: 'A.' });
    expect(ok.status).toBe(201);
  });

  test('PUT /knowledge/:id rejects a malformed id', async () => {
    const res = await request(app).put('/api/support/knowledge/not-a-uuid').set(fmAuth).send({ question: 'Q', answer: 'A' });
    expect(res.status).toBe(400);
  });

  test('DELETE /knowledge/:id rejects a malformed id', async () => {
    const res = await request(app).delete('/api/support/knowledge/not-a-uuid').set(fmAuth);
    expect(res.status).toBe(400);
  });

  test('DELETE /knowledge/:id 404s on a missing entry', async () => {
    mockKnowledgeBase.findByPk.mockResolvedValue(null);
    const res = await request(app).delete(`/api/support/knowledge/${MISSING_ID}`).set(fmAuth);
    expect(res.status).toBe(404);
  });
});
