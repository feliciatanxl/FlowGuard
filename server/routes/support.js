const express = require('express');
const router = express.Router();
const { readLimiter, chatLimiter } = require('../middlewares/rateLimit');
router.use(readLimiter); // route-wide rate limiting
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');
const { ChatTranscript, SupportTicket, KnowledgeBase, User, IncidentLog, sequelize } = require('../models');
const { verifyToken, requireRole } = require('../middlewares/auth');
const { handleChatMessage } = require('../services/supportService');

const TICKET_STATUSES = ['Pending', 'Investigating', 'Resolved', 'Closed'];
const MAX_MESSAGE_LENGTH = 2000;

// Bare UUID format check — every id in this file (tickets, KB entries, chat
// sessions) is a UUID column, and passing a malformed string straight to
// Sequelize makes Postgres throw at the SQL layer, turning into a generic 500
// instead of a clean 400.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUUID = (value) => UUID_RE.test(String(value || ''));

// Shared "search across a few text columns" where-clause builder — used by
// both the ticket list and the knowledge base list.
const buildSearchWhere = (term, fields) => {
  const pattern = `%${term}%`;
  return { [Op.or]: fields.map(field => ({ [field]: { [Op.iLike]: pattern } })) };
};

// If the request carries a valid, currently-active session, returns
// server-verified { userId, tenantName } to override whatever the client body
// claims — the public /chat endpoint has no required auth, so an unverified
// request body is otherwise free to name any tenant/unit it likes. There is
// no authoritative per-user unit number anywhere in this schema, so
// `unitNumber` stays client-supplied/unverified even for logged-in tenants.
async function resolveVerifiedIdentity(req) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return null;

  try {
    const decoded = jwt.verify(token, process.env.APP_SECRET);
    const account = await User.findByPk(decoded.id);
    if (!account || account.isActive === false) return null;
    return { userId: account.id, tenantName: account.name };
  } catch {
    return null; // invalid/expired token — proceed anonymously rather than failing the chat request
  }
}

// ─── C: POST /api/support/chat ───────────────────────────────────────────────
// Public — tenants (and unauthenticated users) interact with the AI bot.
// Logs every exchange into ChatTranscripts. Auto-creates a Support_Ticket
// when AI cannot resolve the issue. All chat/escalation/KB-matching logic
// lives in services/supportService.js — this route only handles HTTP concerns.
router.post('/chat', chatLimiter, async (req, res) => {
  const { sessionId, message, unitNumber } = req.body;
  let { userId, tenantName } = req.body;

  if (!sessionId || !isValidUUID(sessionId)) {
    return res.status(400).json({ error: 'A valid sessionId is required.' });
  }
  if (!message?.trim()) {
    return res.status(400).json({ error: 'message is required.' });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` });
  }

  const verified = await resolveVerifiedIdentity(req);
  if (verified) {
    userId = verified.userId;
    tenantName = verified.tenantName;
  }

  try {
    const result = await handleChatMessage({ sessionId, message, userId, tenantName, unitNumber });

    res.json({
      response: result.aiText,
      escalated: result.escalated,
      ticketId: result.ticketId
    });
  } catch (err) {
    console.error('Support chat error:', err);
    res.status(500).json({ error: 'Chat service is temporarily unavailable.' });
  }
});

// ─── R: GET /api/support/chat/:sessionId ─────────────────────────────────────
// Public — lets the chat widget rehydrate an existing session's history after
// a page refresh (sessionId lives in sessionStorage, but messages didn't
// survive a reload before this endpoint existed). Returns an empty history
// rather than 404 for a brand-new/unknown session — that's the normal case
// for a first-time visitor, not an error.
router.get('/chat/:sessionId', async (req, res) => {
  if (!isValidUUID(req.params.sessionId)) {
    return res.status(400).json({ error: 'Invalid session id.' });
  }

  try {
    const transcript = await ChatTranscript.findOne({
      where: { sessionId: req.params.sessionId },
      include: [{ model: SupportTicket, as: 'ticket', attributes: ['id'] }]
    });

    if (!transcript) {
      return res.json({ messages: [], escalated: false, ticketId: null });
    }

    res.json({
      messages: transcript.messages,
      escalated: transcript.isEscalated,
      ticketId: transcript.ticket ? String(transcript.ticket.id).slice(0, 8).toUpperCase() : null
    });
  } catch (err) {
    console.error('Fetch chat history error:', err);
    res.status(500).json({ error: 'Could not retrieve chat history.' });
  }
});

// ─── R: GET /api/support/tickets ─────────────────────────────────────────────
// FM only — display the ticket queue with search, filtering and pagination.
// ?status=Pending|Investigating|Resolved|Closed
// ?category=<free text, exact match>
// ?q=<text>            — matches issue title/description/tenant/unit
// ?archived=true        — show the archive view instead of the active queue
// ?page=1&limit=20       — limit is capped at 100
router.get('/tickets', verifyToken, requireRole('FM'), async (req, res) => {
  try {
    const where = { isArchived: req.query.archived === 'true' };

    if (req.query.status && TICKET_STATUSES.includes(req.query.status)) {
      where.status = req.query.status;
    }
    if (req.query.category && String(req.query.category).trim()) {
      where.category = String(req.query.category).trim();
    }
    if (req.query.q && String(req.query.q).trim()) {
      Object.assign(where, buildSearchWhere(String(req.query.q).trim(), ['issueTitle', 'issueDescription', 'tenantName', 'unitNumber']));
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const { rows, count } = await SupportTicket.findAndCountAll({
      where,
      order: [
        ['priority', 'DESC'],  // High first
        ['createdAt', 'DESC']
      ],
      include: [{
        model: ChatTranscript,
        as: 'transcript',
        attributes: ['id', 'sessionId', 'tenantName', 'unitNumber', 'messages', 'isEscalated', 'createdAt']
      }],
      limit,
      offset: (page - 1) * limit
    });

    res.json({
      tickets: rows,
      pagination: { page, limit, total: count, totalPages: Math.max(1, Math.ceil(count / limit)) }
    });
  } catch (err) {
    console.error('Fetch tickets error:', err);
    res.status(500).json({ error: 'Could not retrieve support tickets.' });
  }
});

// ─── C: POST /api/support/tickets ────────────────────────────────────────────
// FM only — manually create a ticket without going through the tenant chat/
// auto-escalation flow (e.g. escalating an incident from another module).
// transcriptId is intentionally omitted; there is no chat transcript behind a
// manual escalation.
router.post('/tickets', verifyToken, requireRole('FM'), async (req, res) => {
  const { issueTitle, issueDescription, category, priority, tenantName, unitNumber, sourceIncidentId } = req.body;

  // Incident escalation uses the existing ticket schema without inventing a
  // relationship column. The server loads the incident itself, stores a stable
  // textual reference, and serializes creates so repeated confirmations cannot
  // create duplicate tickets.
  if (sourceIncidentId !== undefined) {
    if (!Number.isInteger(Number(sourceIncidentId)) || Number(sourceIncidentId) <= 0) {
      return res.status(400).json({ error: 'sourceIncidentId must be a positive integer.' });
    }
    try {
      const incident = await IncidentLog.findByPk(Number(sourceIncidentId));
      if (!incident) return res.status(404).json({ error: 'Incident not found.' });
      const row = typeof incident.toJSON === 'function' ? incident.toJSON() : incident;
      const stableTitle = `Incident #${row.id}: ${row.camera_location}`.substring(0, 255);
      const description = [
        `Escalated from FlowGuard Incident #${row.id}.`,
        `Location: ${row.camera_location}.`,
        `Incident type: ${row.status || 'Not recorded'}.`,
        `Source: ${row.source || 'Not recorded'}.`,
        `Severity: ${row.severity || 'Not recorded'}.`,
        row.notes?.trim() ? `Description: ${row.notes.trim()}` : 'Description: No description provided.'
      ].join('\n');
      const result = await sequelize.transaction(async (transaction) => {
        await sequelize.query('SELECT pg_advisory_xact_lock(hashtext(:dedupKey))', {
          replacements: { dedupKey: `support-incident-${row.id}` },
          transaction
        });
        const existing = await SupportTicket.findOne({ where: { issueTitle: stableTitle }, transaction });
        if (existing) return { ticket: existing, duplicate: true };
        const ticket = await SupportTicket.create({
          issueTitle: stableTitle,
          issueDescription: description,
          category: 'Security Incident',
          priority: ['High', 'Critical'].includes(row.severity) ? 'High' : row.severity === 'Medium' ? 'Medium' : 'Low',
          status: 'Pending',
          tenantName: null,
          unitNumber: null
        }, { transaction });
        return { ticket, duplicate: false };
      });
      return res.status(result.duplicate ? 200 : 201).json({
        message: result.duplicate ? 'This incident already has a support ticket.' : 'Incident escalated to Support Tickets.',
        ticket: result.ticket,
        duplicate: result.duplicate
      });
    } catch (err) {
      console.error('Incident ticket escalation error:', err);
      return res.status(500).json({ error: 'Could not escalate the incident to Support Tickets.' });
    }
  }

  if (!issueTitle?.trim() || !issueDescription?.trim()) {
    return res.status(400).json({ error: 'issueTitle and issueDescription are required.' });
  }
  if (priority && !['Low', 'Medium', 'High'].includes(priority)) {
    return res.status(400).json({ error: 'priority must be one of: Low, Medium, High.' });
  }

  try {
    const ticket = await SupportTicket.create({
      issueTitle: issueTitle.trim().substring(0, 255),
      issueDescription: issueDescription.trim(),
      category: category?.trim() || 'General',
      priority: priority || 'Medium',
      status: 'Pending',
      tenantName: tenantName?.trim() || null,
      unitNumber: unitNumber?.trim() || null
    });
    res.status(201).json({ message: 'Ticket created.', ticket });
  } catch (err) {
    console.error('Manual ticket create error:', err);
    res.status(500).json({ error: 'Could not create ticket.' });
  }
});

// ─── R: GET /api/support/tickets/stats ───────────────────────────────────────
// FM only — summary counts for the dashboard cards. Scoped to the active
// (non-archived) queue, matching what the ticket list shows by default.
// Registered BEFORE /tickets/:id so Express doesn't treat "stats" as an id.
router.get('/tickets/stats', verifyToken, requireRole('FM'), async (req, res) => {
  try {
    const activeWhere = { isArchived: false };
    const [total, highPriority, investigating, resolved] = await Promise.all([
      SupportTicket.count({ where: activeWhere }),
      SupportTicket.count({ where: { ...activeWhere, priority: 'High' } }),
      SupportTicket.count({ where: { ...activeWhere, status: 'Investigating' } }),
      SupportTicket.count({ where: { ...activeWhere, status: 'Resolved' } })
    ]);

    res.json({ total, highPriority, investigating, resolved });
  } catch (err) {
    console.error('Fetch ticket stats error:', err);
    res.status(500).json({ error: 'Could not retrieve ticket statistics.' });
  }
});

// ─── R: GET /api/support/tickets/:id ─────────────────────────────────────────
// FM only — single ticket with full linked chat transcript.
router.get('/tickets/:id', verifyToken, requireRole('FM'), async (req, res) => {
  if (!isValidUUID(req.params.id)) {
    return res.status(400).json({ error: 'Invalid ticket id.' });
  }

  try {
    const ticket = await SupportTicket.findByPk(req.params.id, {
      include: [{
        model: ChatTranscript,
        as: 'transcript'
      }]
    });
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });
    res.json(ticket);
  } catch (err) {
    console.error('Fetch ticket error:', err);
    res.status(500).json({ error: 'Could not retrieve ticket.' });
  }
});

// ─── U: PATCH /api/support/tickets/:id/status ────────────────────────────────
// FM only — update ticket status (and optionally category/notes) after
// physical intervention. Body: { status, resolutionNotes?, category? }
router.patch('/tickets/:id/status', verifyToken, requireRole('FM'), async (req, res) => {
  if (!isValidUUID(req.params.id)) {
    return res.status(400).json({ error: 'Invalid ticket id.' });
  }

  const { status, resolutionNotes, category } = req.body;

  if (!status || !TICKET_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${TICKET_STATUSES.join(', ')}.` });
  }

  try {
    const ticket = await SupportTicket.findByPk(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    const update = { status };
    if (resolutionNotes !== undefined) update.resolutionNotes = resolutionNotes;
    if (category !== undefined && String(category).trim()) update.category = String(category).trim();

    if (status === 'Resolved') {
      update.resolvedBy = req.user.email || req.user.name || `FM #${req.user.id}`;
      update.resolvedAt = new Date();
    } else {
      // Reopening a previously-resolved ticket must not leave a stale
      // "Resolved by ..." caption once it's no longer actually resolved.
      update.resolvedBy = null;
      update.resolvedAt = null;
    }

    await ticket.update(update);
    res.json({ message: `Ticket marked "${status}".`, ticket });
  } catch (err) {
    console.error('Update ticket error:', err);
    res.status(500).json({ error: 'Could not update ticket status.' });
  }
});

// ─── U: PATCH /api/support/tickets/:id/archive ───────────────────────────────
// FM only — reversible archive/restore, distinct from the hard DELETE below.
// Body: { archived: boolean }
router.patch('/tickets/:id/archive', verifyToken, requireRole('FM'), async (req, res) => {
  if (!isValidUUID(req.params.id)) {
    return res.status(400).json({ error: 'Invalid ticket id.' });
  }

  const { archived } = req.body;

  if (typeof archived !== 'boolean') {
    return res.status(400).json({ error: 'archived (boolean) is required.' });
  }

  try {
    const ticket = await SupportTicket.findByPk(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    await ticket.update({ isArchived: archived });
    res.json({ message: archived ? 'Ticket archived.' : 'Ticket restored from archive.', ticket });
  } catch (err) {
    console.error('Archive ticket error:', err);
    res.status(500).json({ error: 'Could not update archive status.' });
  }
});

// ─── D: DELETE /api/support/tickets/:id ──────────────────────────────────────
// FM only — hard-delete a closed or spam ticket (and its linked transcript).
// Both deletes happen in one transaction so a failure partway through can
// never leave the ticket gone but its transcript orphaned (or vice versa).
router.delete('/tickets/:id', verifyToken, requireRole('FM'), async (req, res) => {
  if (!isValidUUID(req.params.id)) {
    return res.status(400).json({ error: 'Invalid ticket id.' });
  }

  try {
    const ticket = await SupportTicket.findByPk(req.params.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found.' });

    const transcriptId = ticket.transcriptId;
    await sequelize.transaction(async (t) => {
      await ticket.destroy({ transaction: t });
      if (transcriptId) {
        await ChatTranscript.destroy({ where: { id: transcriptId }, transaction: t });
      }
    });

    res.json({ message: 'Ticket and linked transcript deleted.' });
  } catch (err) {
    console.error('Delete ticket error:', err);
    res.status(500).json({ error: 'Could not delete ticket.' });
  }
});

// ─── R: GET /api/support/knowledge ───────────────────────────────────────────
// Public — the chatbot and FM dashboard both read from here.
// ?category=<free text, exact match>
// ?q=<text>   — matches question/answer
router.get('/knowledge', async (req, res) => {
  try {
    const where = {};
    if (req.query.category && String(req.query.category).trim()) {
      where.category = String(req.query.category).trim();
    }
    if (req.query.q && String(req.query.q).trim()) {
      Object.assign(where, buildSearchWhere(String(req.query.q).trim(), ['question', 'answer']));
    }

    const entries = await KnowledgeBase.findAll({ where, order: [['category', 'ASC'], ['createdAt', 'DESC']] });
    res.json(entries);
  } catch (err) {
    console.error('Fetch KB error:', err);
    res.status(500).json({ error: 'Could not retrieve knowledge base.' });
  }
});

// ─── C: POST /api/support/knowledge ──────────────────────────────────────────
// FM only — add a new FAQ to the chatbot knowledge base.
router.post('/knowledge', verifyToken, requireRole('FM'), async (req, res) => {
  const { category, question, answer, keywords } = req.body;

  if (!question?.trim() || !answer?.trim()) {
    return res.status(400).json({ error: 'question and answer are required.' });
  }

  try {
    const entry = await KnowledgeBase.create({
      category: category?.trim() || 'General',
      question: question.trim(),
      answer: answer.trim(),
      keywords: Array.isArray(keywords) ? keywords.map(k => k.toLowerCase().trim()).filter(Boolean) : [],
      createdBy: req.user.email || req.user.name || `FM #${req.user.id}`
    });
    res.status(201).json({ message: 'Knowledge base entry added.', entry });
  } catch (err) {
    console.error('Create KB error:', err);
    res.status(500).json({ error: 'Could not add knowledge base entry.' });
  }
});

// ─── U: PUT /api/support/knowledge/:id ───────────────────────────────────────
// FM only — update an existing FAQ (e.g., add loading bay rules).
router.put('/knowledge/:id', verifyToken, requireRole('FM'), async (req, res) => {
  if (!isValidUUID(req.params.id)) {
    return res.status(400).json({ error: 'Invalid knowledge base entry id.' });
  }

  const { category, question, answer, keywords } = req.body;

  try {
    const entry = await KnowledgeBase.findByPk(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Knowledge base entry not found.' });

    await entry.update({
      category: category?.trim() ?? entry.category,
      question: question?.trim() ?? entry.question,
      answer: answer?.trim() ?? entry.answer,
      keywords: Array.isArray(keywords) ? keywords.map(k => k.toLowerCase().trim()).filter(Boolean) : entry.keywords,
      updatedBy: req.user.email || req.user.name || `FM #${req.user.id}`
    });

    res.json({ message: 'Knowledge base entry updated.', entry });
  } catch (err) {
    console.error('Update KB error:', err);
    res.status(500).json({ error: 'Could not update knowledge base entry.' });
  }
});

// ─── D: DELETE /api/support/knowledge/:id ────────────────────────────────────
// FM only — remove an outdated or incorrect FAQ.
router.delete('/knowledge/:id', verifyToken, requireRole('FM'), async (req, res) => {
  if (!isValidUUID(req.params.id)) {
    return res.status(400).json({ error: 'Invalid knowledge base entry id.' });
  }

  try {
    const entry = await KnowledgeBase.findByPk(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Knowledge base entry not found.' });
    await entry.destroy();
    res.json({ message: 'Knowledge base entry deleted.' });
  } catch (err) {
    console.error('Delete KB error:', err);
    res.status(500).json({ error: 'Could not delete knowledge base entry.' });
  }
});

module.exports = router;
