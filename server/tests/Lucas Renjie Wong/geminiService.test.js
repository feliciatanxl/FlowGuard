const { generateChatReply } = require('../../services/geminiService');

const KB = [{ category: 'Access Control', question: 'Why does my face scan fail?', answer: 'Re-enrol in good lighting.', keywords: ['face'] }];

const okResponse = (text) => ({
  ok: true,
  status: 200,
  json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] })
});

const errorResponse = (status, body = 'error') => ({
  ok: false,
  status,
  text: async () => body
});

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_MODEL = 'gemini-2.0-flash';
  process.env.GEMINI_TIMEOUT_MS = '2000';
  process.env.GEMINI_MAX_RETRIES = '1';
  global.fetch = jest.fn();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.restoreAllMocks();
});

describe('generateChatReply', () => {
  test('returns the model text on a successful response', async () => {
    global.fetch.mockResolvedValue(okResponse('Try re-enrolling your face.'));

    const text = await generateChatReply({ message: 'my face scan fails', kbEntries: KB });

    expect(text).toBe('Try re-enrolling your face.');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain('gemini-2.0-flash');
    expect(url).toContain('key=test-key');
  });

  test('rejects immediately when GEMINI_API_KEY is not configured', async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(generateChatReply({ message: 'hi', kbEntries: [] })).rejects.toThrow(/not configured/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('times out without retrying (fails fast rather than doubling the wait)', async () => {
    process.env.GEMINI_TIMEOUT_MS = '20';
    global.fetch.mockImplementation((url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      });
    }));

    await expect(generateChatReply({ message: 'hi', kbEntries: [] })).rejects.toThrow();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('does not retry an invalid-API-key response (400)', async () => {
    global.fetch.mockResolvedValue(errorResponse(400, 'API key not valid. Please pass a valid API key.'));

    await expect(generateChatReply({ message: 'hi', kbEntries: [] })).rejects.toThrow(/400/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('retries a transient 500 once, then throws if it keeps failing', async () => {
    global.fetch.mockResolvedValue(errorResponse(500, 'internal error'));

    await expect(generateChatReply({ message: 'hi', kbEntries: [] })).rejects.toThrow(/500/);
    expect(global.fetch).toHaveBeenCalledTimes(2); // 1 original + 1 retry (GEMINI_MAX_RETRIES=1)
  });

  test('retries a transient 500 and succeeds on the second attempt', async () => {
    global.fetch
      .mockResolvedValueOnce(errorResponse(500, 'internal error'))
      .mockResolvedValueOnce(okResponse('Recovered answer.'));

    const text = await generateChatReply({ message: 'hi', kbEntries: [] });

    expect(text).toBe('Recovered answer.');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('a network-level rejection is treated as retryable', async () => {
    global.fetch
      .mockRejectedValueOnce(Object.assign(new Error('fetch failed'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce(okResponse('Back online.'));

    const text = await generateChatReply({ message: 'hi', kbEntries: [] });

    expect(text).toBe('Back online.');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('rejects when the response has no usable text', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ candidates: [] }) });

    await expect(generateChatReply({ message: 'hi', kbEntries: [] })).rejects.toThrow(/no text/i);
  });
});
