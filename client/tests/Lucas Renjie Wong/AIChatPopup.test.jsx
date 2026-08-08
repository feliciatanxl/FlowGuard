// Frontend tests for the public AI Helpdesk chat widget. Covers: closed-by-default
// rendering, rehydrating an existing session's history + escalation banner on
// mount, sending a message and rendering the AI reply, and restoring the input
// text (rather than losing it) when the request fails.
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, test, expect, beforeEach } from 'vitest';

const { mockGet, mockPost } = vi.hoisted(() => ({ mockGet: vi.fn(), mockPost: vi.fn() }));
vi.mock('axios', () => ({ default: { get: mockGet, post: mockPost } }));

// jsdom doesn't implement scrollIntoView; the widget calls it on every new message.
Element.prototype.scrollIntoView = vi.fn();

import AIChatPopup from '../../src/components/AIChatPopup';

const SESSION_ID = '11111111-1111-1111-1111-111111111111';

const mountWidget = () => {
  sessionStorage.setItem('fg_chat_session', SESSION_ID);
  render(<AIChatPopup />);
};

const openWidget = async () => {
  fireEvent.click(screen.getByRole('button', { name: /toggle ai chat/i }));
  return screen.findByPlaceholderText(/ask about site protocols/i);
};

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  sessionStorage.clear();
  localStorage.clear();
  mockGet.mockResolvedValue({ data: { messages: [], escalated: false, ticketId: null } });
});

describe('AIChatPopup', () => {
  test('renders closed by default and opens on FAB click', async () => {
    mountWidget();
    expect(screen.queryByPlaceholderText(/ask about site protocols/i)).not.toBeInTheDocument();
    await openWidget();
    expect(screen.getByPlaceholderText(/ask about site protocols/i)).toBeInTheDocument();
  });

  test('rehydrates existing history and the escalation banner on mount', async () => {
    mockGet.mockResolvedValue({
      data: {
        messages: [{ role: 'user', text: 'my gate is broken', timestamp: 'now' }],
        escalated: true,
        ticketId: 'A1B2C3D4'
      }
    });
    mountWidget();
    await openWidget();

    await waitFor(() => expect(screen.getByText('my gate is broken')).toBeInTheDocument());
    expect(screen.getByText(/ticket #a1b2c3d4 created/i)).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith(`/api/support/chat/${SESSION_ID}`);
  });

  test('a transient rehydration failure is silent — the widget still opens with just the greeting', async () => {
    mockGet.mockRejectedValue(new Error('network error'));
    mountWidget();
    const input = await openWidget();
    expect(input).toBeInTheDocument();
    expect(screen.queryByText(/ticket #/i)).not.toBeInTheDocument();
  });

  test('sends a message and displays the AI reply', async () => {
    mockPost.mockResolvedValue({ data: { response: 'Try re-enrolling your face.', escalated: false, ticketId: null } });
    mountWidget();
    const input = await openWidget();

    fireEvent.change(input, { target: { value: 'my face scan fails' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    expect(screen.getByText('my face scan fails')).toBeInTheDocument(); // optimistic user bubble
    await waitFor(() => expect(screen.getByText('Try re-enrolling your face.')).toBeInTheDocument());
    expect(mockPost).toHaveBeenCalledWith('/api/support/chat', expect.objectContaining({
      sessionId: SESSION_ID,
      message: 'my face scan fails'
    }));
  });

  test('shows the escalation banner and ticket id when a reply escalates', async () => {
    mockPost.mockResolvedValue({ data: { response: 'Escalated.', escalated: true, ticketId: 'B2C3D4E5' } });
    mountWidget();
    const input = await openWidget();

    fireEvent.change(input, { target: { value: 'this keeps failing, please help' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(screen.getByText(/ticket #b2c3d4e5 created/i)).toBeInTheDocument());
  });

  test('restores the input text when the send request fails, instead of losing it', async () => {
    mockPost.mockRejectedValue(new Error('network error'));
    mountWidget();
    const input = await openWidget();

    fireEvent.change(input, { target: { value: 'hello there' } });
    fireEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(screen.getByText(/temporarily unable to process/i)).toBeInTheDocument());
    expect(input.value).toBe('hello there');
  });

  test('the send button is disabled while a request is in flight and when the input is empty', async () => {
    let resolvePost;
    mockPost.mockImplementation(() => new Promise((resolve) => { resolvePost = resolve; }));
    mountWidget();
    const input = await openWidget();

    const sendButton = screen.getByRole('button', { name: /^send$/i });
    expect(sendButton).toBeDisabled(); // empty input

    fireEvent.change(input, { target: { value: 'hi' } });
    expect(sendButton).not.toBeDisabled();

    fireEvent.click(sendButton);
    expect(sendButton).toBeDisabled(); // in flight

    resolvePost({ data: { response: 'ok', escalated: false, ticketId: null } });
    await waitFor(() => expect(screen.getByText('ok')).toBeInTheDocument());
  });
});
