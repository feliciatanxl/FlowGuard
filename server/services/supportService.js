// AI Helpdesk chat orchestration: transcript persistence, auto-escalation, and
// knowledge-base matching for Module 3. This module performs NO Express work;
// routes/support.js is a thin adapter that calls handleChatMessage and maps the
// result onto the HTTP response, matching how gateVerification.js separates
// domain logic from its route.
//
// Matching is deterministic keyword/token scoring, not an LLM or embeddings —
// ai-service only has FACE embeddings (InsightFace) for Module 1; there is no
// text-embedding endpoint or vector database in this project.

const { ChatTranscript, SupportTicket, KnowledgeBase, sequelize } = require('../models');
const { generateChatReply, generateStatusMessage } = require('./geminiService');

// ─── ESCALATION ──────────────────────────────────────────────────────────────

// Words/phrases that signal the user is stuck and needs human intervention.
const ESCALATION_TRIGGERS = [
  'still not working', 'still failing', 'keeps failing', 'keep failing',
  'not fixed', 'not resolved', 'wont work', "won't work", "doesn't work",
  "doesn't resolve", 'broken', 'cannot access', 'unable to access',
  'still broken', 'please fix', 'urgent', 'emergency', 'escalate',
  'human', 'real person', 'speak to someone', 'talk to someone',
  'face scan fail', 'scan keep', 'scan keeps', 'camera broken',
  'gate not opening', 'door not opening', 'lock not working',
  'been happening', 'days now', 'weeks now', 'hours now'
];

// Auto-escalate once the tenant has sent this many messages without resolution.
const AUTO_ESCALATE_MESSAGE_COUNT = 5;

function shouldEscalate(message, userMessageCount) {
  const lower = message.toLowerCase();
  const hasTrigger = ESCALATION_TRIGGERS.some(t => lower.includes(t));
  // A trigger word on the tenant's very FIRST message never escalates on its
  // own — the knowledge base gets one attempt first, so a brand-new session
  // can't skip straight past the AI by opening with "this is urgent". From
  // the second message onward a trigger word escalates immediately.
  if (userMessageCount <= 1) return userMessageCount >= AUTO_ESCALATE_MESSAGE_COUNT;
  return hasTrigger || userMessageCount >= AUTO_ESCALATE_MESSAGE_COUNT;
}

// ─── KNOWLEDGE BASE MATCHING ─────────────────────────────────────────────────

// Filler words dropped before scoring so they can't inflate a match — plain
// length>2 filtering (the original approach) still let words like "the",
// "and", "for" count as signal on every entry.
const STOPWORDS = new Set([
  'the', 'is', 'are', 'was', 'were', 'and', 'for', 'with', 'that', 'this',
  'have', 'has', 'had', 'can', 'will', 'would', 'could', 'should', 'you',
  'your', 'yours', 'about', 'from', 'into', 'not', 'but', 'out', 'off',
  'how', 'why', 'what', 'when', 'where', 'who', 'does', 'did', 'been',
  'being', 'they', 'them', 'their', 'then', 'than', 'also', 'just', 'get',
  'got', 'need', 'want', 'please', 'okay'
]);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[\s,?.!;:()\-]+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

// Score a KB entry against the tenant's already-tokenized message. Curated
// keywords count double a bare question-text overlap (an FM deliberately
// tagged that word), and the result also reports what fraction of the
// tenant's meaningful words actually matched — a long, mostly-unrelated
// message needs more than two incidental hits to look like a confident match.
function scoreEntry(queryTokens, entry) {
  if (queryTokens.length === 0) return { rawScore: 0, confidence: 0 };

  const keywordTokens = (entry.keywords || []).map(k => String(k).toLowerCase());
  const questionTokens = tokenize(entry.question);

  let rawScore = 0;
  let matchedCount = 0;
  for (const qt of queryTokens) {
    const keywordHit = keywordTokens.some(kt => kt.includes(qt) || qt.includes(kt));
    const questionHit = !keywordHit && questionTokens.some(t => t.includes(qt) || qt.includes(t));
    if (keywordHit) { rawScore += 2; matchedCount += 1; }
    else if (questionHit) { rawScore += 1; matchedCount += 1; }
  }

  return { rawScore, confidence: matchedCount / queryTokens.length };
}

// Minimum absolute signal AND minimum proportion of the message that matched.
const MIN_SCORE = 2;
const MIN_CONFIDENCE = 0.34;

function findBestKBMatch(query, kbEntries) {
  // Tokenized once and reused for every entry — the tenant's message doesn't
  // change per KB entry, so re-tokenizing it inside the loop was pure waste.
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const entry of kbEntries) {
    const { rawScore, confidence } = scoreEntry(queryTokens, entry);
    if (rawScore >= MIN_SCORE && confidence >= MIN_CONFIDENCE && rawScore > bestScore) {
      bestScore = rawScore;
      best = entry;
    }
  }
  return best;
}

// ─── TICKET CATEGORISATION ───────────────────────────────────────────────────

// Fallback classifier used only when no KB entry matched closely enough to
// borrow its category. Kept as a static keyword map — no new infrastructure —
// matching the "improve the keyword scorer" scope decision for this feature.
const CATEGORY_KEYWORDS = [
  { category: 'Access Control', keywords: ['face', 'scan', 'biometric', 'facial', 'recognition', 'gate', 'access', 'card', 'enroll', 'enrolment', 'enrollment'] },
  { category: 'Loading Bay', keywords: ['loading', 'bay', 'delivery', 'driver', 'dock', 'truck', 'lorry', 'booking'] },
  { category: 'Visitor Parking', keywords: ['parking', 'visitor', 'carpark', 'lot', 'vehicle'] },
  { category: 'Security', keywords: ['camera', 'alarm', 'security', 'incident', 'suspicious', 'intruder'] }
];

function inferCategory(message, matchedEntry) {
  if (matchedEntry?.category) return matchedEntry.category;

  const tokens = tokenize(message);
  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    if (tokens.some(t => keywords.some(k => k.includes(t) || t.includes(k)))) return category;
  }
  return 'General';
}

function buildTicketTitle(message) {
  return message.length > 100 ? message.substring(0, 97) + '...' : message;
}

// ─── ORCHESTRATION ───────────────────────────────────────────────────────────

// Handles one tenant chat turn end-to-end: loads/opens the session transcript,
// decides whether to escalate or answer from the knowledge base, persists the
// full exchange, and returns what the route needs to build its HTTP response.
//
// `tenantName`/`userId`/`unitNumber` are trusted as given — the caller (the
// route) is responsible for overriding them with server-verified values when
// the request carried a valid session, since this service has no HTTP/auth
// context of its own.
async function handleChatMessage({ sessionId, message, userId, tenantName, unitNumber }) {
  const trimmedMessage = message.trim();

  const [transcript] = await ChatTranscript.findOrCreate({
    where: { sessionId },
    defaults: {
      sessionId,
      userId: userId || null,
      tenantName: tenantName || null,
      unitNumber: unitNumber || null,
      messages: [],
      isEscalated: false
    }
  });

  const wasAlreadyEscalated = transcript.isEscalated;
  const userMessageCount = transcript.messages.filter(m => m.role === 'user').length;

  const updatedMessages = [
    ...transcript.messages,
    { role: 'user', text: trimmedMessage, timestamp: new Date().toISOString() }
  ];

  const baseUpdate = {
    userId: userId || transcript.userId,
    tenantName: tenantName || transcript.tenantName,
    unitNumber: unitNumber || transcript.unitNumber
  };

  let aiText;
  let newTicket = null;

  if (wasAlreadyEscalated) {
    // The FACT (already escalated, FM will follow up) is fixed — Gemini only
    // phrases it, and any failure falls back to the exact same fixed text.
    try {
      aiText = await generateStatusMessage({
        situation: 'their issue is already being tracked by the Facilities Management (FM) team from an earlier message, and FM will contact them soon — invite them to add any extra details for FM in the meantime'
      });
    } catch (err) {
      console.error('Gemini status message failed, using fixed text:', err.message);
      aiText = 'Your issue is already being tracked by our FM team. They will contact you soon. Is there any additional information I can pass on to them?';
    }
    updatedMessages.push({ role: 'ai', text: aiText, timestamp: new Date().toISOString() });
    await transcript.update({ ...baseUpdate, messages: updatedMessages });
  } else {
    const kbEntries = await KnowledgeBase.findAll();
    const match = findBestKBMatch(trimmedMessage, kbEntries);

    if (shouldEscalate(trimmedMessage, userMessageCount + 1)) {
      // ── AUTO-ESCALATION ──────────────────────────────────────────────────
      // Ticket creation and marking the transcript escalated must succeed
      // together — otherwise a write failure between the two can create a
      // ticket the tenant is never told about (and whose transcript never
      // records isEscalated, so their next message could create a duplicate).
      await sequelize.transaction(async (t) => {
        newTicket = await SupportTicket.create({
          transcriptId: transcript.id,
          userId: baseUpdate.userId || null,
          tenantName: baseUpdate.tenantName || null,
          unitNumber: baseUpdate.unitNumber || null,
          issueTitle: buildTicketTitle(trimmedMessage),
          issueDescription: `Escalated from AI chat session ${sessionId}.\n\nTenant's last message: "${trimmedMessage}"`,
          category: inferCategory(trimmedMessage, match),
          priority: 'High',
          status: 'Pending'
        }, { transaction: t });

        const shortId = String(newTicket.id).slice(0, 8).toUpperCase();
        // The DECISION (escalate, this ticket id) is already made above —
        // Gemini only phrases the confirmation; any failure falls back to
        // the exact same fixed text the tenant would have seen before.
        try {
          aiText = await generateStatusMessage({
            situation: `this is a persistent issue, it has just been escalated to the Facilities Management (FM) team, Ticket #${shortId} was created on their behalf, FM will follow up shortly, and for urgent assistance they can contact the FM office directly at the reception desk`
          });
        } catch (err) {
          console.error('Gemini status message failed, using fixed text:', err.message);
          aiText = `I understand this is a persistent issue. I have escalated your case to our Facilities Management team and created Ticket #${shortId} on your behalf. Our FM staff will follow up shortly. For urgent assistance please contact the FM office directly at the reception desk.`;
        }
        updatedMessages.push({ role: 'ai', text: aiText, timestamp: new Date().toISOString() });

        await transcript.update({
          ...baseUpdate,
          messages: updatedMessages,
          isEscalated: true,
          escalationReason: trimmedMessage
        }, { transaction: t });
      });
    } else {
      // ── AI-GENERATED REPLY ────────────────────────────────────────────────
      // Gemini answers using the knowledge base as grounding context. Any
      // failure (missing key, network, timeout, quota) falls back to the
      // deterministic keyword match computed above — never a broken reply.
      try {
        aiText = await generateChatReply({ message: trimmedMessage, kbEntries });
      } catch (err) {
        console.error('Gemini reply generation failed, falling back to keyword match:', err.message);
        aiText = match
          ? match.answer
          : `I have noted your issue regarding "${trimmedMessage.substring(0, 60)}${trimmedMessage.length > 60 ? '...' : ''}". Could you provide more details — for example, your unit number or what error message you are seeing? If the problem keeps occurring I can escalate this to our FM team right away.`;
      }
      updatedMessages.push({ role: 'ai', text: aiText, timestamp: new Date().toISOString() });
      await transcript.update({ ...baseUpdate, messages: updatedMessages });
    }
  }

  return {
    aiText,
    escalated: !wasAlreadyEscalated && Boolean(newTicket),
    ticketId: newTicket ? String(newTicket.id).slice(0, 8).toUpperCase() : null,
    transcript,
    ticket: newTicket
  };
}

module.exports = {
  handleChatMessage,
  shouldEscalate,
  findBestKBMatch,
  inferCategory,
  buildTicketTitle,
  tokenize,
  AUTO_ESCALATE_MESSAGE_COUNT
};
