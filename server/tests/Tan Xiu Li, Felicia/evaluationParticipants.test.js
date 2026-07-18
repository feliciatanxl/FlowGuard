const mockParticipant = { findOne: jest.fn(), findAll: jest.fn(), create: jest.fn() };
const transaction = { LOCK: { UPDATE: 'UPDATE' } };
const mockSequelize = { transaction: jest.fn((callback) => callback(transaction)) };
jest.mock('../../models', () => ({ sequelize: mockSequelize, User: { findAll: jest.fn() }, EvaluationParticipant: mockParticipant }));
const { formatEvaluationLabel, evaluationLabelSequence, assignStableEvaluationLabel, retireEvaluationParticipant, syncEligibleEvaluationParticipants } = require('../../services/evaluationParticipants');
const { User } = require('../../models');

describe('stable evaluation participant labels', () => {
  beforeEach(() => jest.clearAllMocks());
  test.each([[1,'P01'],[2,'P02'],[9,'P09'],[10,'P10'],[105,'P105']])('formats %s as %s', (number, label) => expect(formatEvaluationLabel(number)).toBe(label));
  test('sort sequence is numeric, not lexical', () => expect(['P10','P02','P105'].sort((a,b) => evaluationLabelSequence(a)-evaluationLabelSequence(b))).toEqual(['P02','P10','P105']));
  test('existing user mapping remains unchanged', async () => { const row = { userId: 7, evaluationLabel: 'P03' }; mockParticipant.findOne.mockResolvedValue(row); expect(await assignStableEvaluationLabel({ id: 7, isEnrolled: true, faceVector: [1] })).toBe(row); expect(mockParticipant.create).not.toHaveBeenCalled(); });
  test('next label uses maximum ever assigned and does not fill gaps or depend on user order/name', async () => { mockParticipant.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null); mockParticipant.findAll.mockResolvedValue([{ evaluationLabel: 'P01' }, { evaluationLabel: 'P02' }, { evaluationLabel: 'P04' }]); mockParticipant.create.mockImplementation((value) => Promise.resolve(value)); const row = await assignStableEvaluationLabel({ id: 99, name: 'AAA', isEnrolled: true, faceVector: [1] }); expect(row.evaluationLabel).toBe('P05'); });
  test('ineligible users are never assigned', async () => { expect(await assignStableEvaluationLabel({ id: 1, isEnrolled: false, faceVector: [1] })).toBeNull(); expect(await assignStableEvaluationLabel({ id: 2, isEnrolled: true, faceVector: null })).toBeNull(); });
});

describe('evaluation participant retirement (PDPA off-boarding)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('mapped participant is retired in place: active=false, retiredAt stamped, label and row preserved', async () => {
    const update = jest.fn().mockResolvedValue(true);
    const row = { userId: 7, evaluationLabel: 'P02', active: true, retiredAt: null, update };
    mockParticipant.findOne.mockResolvedValue(row);
    const tx = { LOCK: { UPDATE: 'UPDATE' } };

    const result = await retireEvaluationParticipant(7, tx);

    expect(mockParticipant.findOne).toHaveBeenCalledWith({ where: { userId: 7 }, transaction: tx });
    expect(update).toHaveBeenCalledWith({ active: false, retiredAt: expect.any(Date) }, { transaction: tx });
    // Only lifecycle fields change — the evaluationLabel is never rewritten
    // and the row is never destroyed (no destroy call exists on the helper path).
    expect(Object.keys(update.mock.calls[0][0]).sort()).toEqual(['active', 'retiredAt']);
    expect(result).toBe(row);
    expect(result.evaluationLabel).toBe('P02');
  });

  test('users without a mapping (or null userId) are a safe no-op', async () => {
    mockParticipant.findOne.mockResolvedValue(null);
    expect(await retireEvaluationParticipant(123, {})).toBeNull();
    expect(await retireEvaluationParticipant(null, {})).toBeNull();
    expect(await retireEvaluationParticipant(undefined, {})).toBeNull();
    // null/undefined userId never queries the table at all.
    expect(mockParticipant.findOne).toHaveBeenCalledTimes(1);
  });

  test('retired labels are still reserved: P01-P03 existing/retired means the next user receives P04', async () => {
    mockParticipant.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    // P01 active, P02 and P03 retired (userId already nulled by off-boarding).
    mockParticipant.findAll.mockResolvedValue([
      { evaluationLabel: 'P01', active: true, userId: 4 },
      { evaluationLabel: 'P02', active: false, userId: null, retiredAt: new Date() },
      { evaluationLabel: 'P03', active: false, userId: null, retiredAt: new Date() },
    ]);
    mockParticipant.create.mockImplementation((value) => Promise.resolve(value));

    const row = await assignStableEvaluationLabel({ id: 42, isEnrolled: true, faceVector: [1] });
    expect(row.evaluationLabel).toBe('P04');
  });
});
describe('full participant coverage (every non-deleted user gets a stable P-label)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('sync assigns labels to unenrolled, suspended and every role — existing mappings untouched', async () => {
    User.findAll.mockResolvedValue([
      { id: 1, name: 'FM Admin', role: 'FM', isActive: true, isEnrolled: true, faceVector: [1] },
      { id: 2, name: 'Tenant No Face', role: 'Tenant', isActive: true, isEnrolled: false, faceVector: null },
      { id: 3, name: 'Suspended Staff', role: 'Staff', isActive: false, isEnrolled: true, faceVector: [1] },
    ]);
    // id 1 already mapped; ids 2 and 3 have no mapping yet.
    mockParticipant.findOne.mockImplementation(({ where }) =>
      Promise.resolve(where.userId === 1 ? { userId: 1, evaluationLabel: 'P01' } : null));
    mockParticipant.findAll.mockResolvedValue([{ evaluationLabel: 'P01' }]);
    const created = [];
    mockParticipant.create.mockImplementation((value) => { created.push(value); return Promise.resolve(value); });

    const assigned = await syncEligibleEvaluationParticipants();
    expect(assigned).toHaveLength(3);
    // The unenrolled Tenant and suspended Staff BOTH receive labels.
    expect(created.map((c) => c.userId).sort()).toEqual([2, 3]);
    // Existing P01 is reused, never recreated or renumbered.
    expect(created.some((c) => c.evaluationLabel === 'P01')).toBe(false);
  });

  test('default direct assignment still requires eligibility (enrolment-time behaviour unchanged)', async () => {
    expect(await assignStableEvaluationLabel({ id: 5, isEnrolled: false, faceVector: null })).toBeNull();
  });
});
