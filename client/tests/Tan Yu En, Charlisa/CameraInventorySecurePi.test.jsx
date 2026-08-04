import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import '@testing-library/jest-dom';
import axios from 'axios';
import CameraInventory from '../../src/pages/CameraInventory';

vi.mock('axios');
vi.mock('../../src/components/Sidebar', () => ({ default: () => null }));

const securePiFetch = vi.fn();
const jsonResponse = (body, ok = true) => ({ ok, json: vi.fn().mockResolvedValue(body) });

const renderPage = () => render(<MemoryRouter><CameraInventory /></MemoryRouter>);

const selectCustomSource = () => {
  fireEvent.change(screen.getByLabelText('Video Source'), { target: { value: 'custom' } });
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('userRole', 'FM');
  localStorage.setItem('accessToken', 'cloud-jwt-used-only-for-flowguard');
  vi.stubGlobal('fetch', securePiFetch);
  axios.get.mockImplementation((url) => {
    if (url === '/api/cameras' || url === '/api/zones') return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Camera Inventory SecurePi connection test', () => {
  test('validates health before people-count without saving or sending cloud authentication', async () => {
    securePiFetch
      .mockResolvedValueOnce(jsonResponse({ status: 'ok', camera: 'Sony IMX500', device_id: 'securepi-01', zone: 'Loading Bay' }))
      .mockResolvedValueOnce(jsonResponse({ count: 2, detection_active: true, age_seconds: 1.5 }));
    renderPage();
    await screen.findByText(/No cameras in inventory yet/);
    selectCustomSource();
    fireEvent.change(screen.getByLabelText('Stream URL'), { target: { value: 'http://securepi.local:5001/video_feed' } });

    fireEvent.click(screen.getByRole('button', { name: 'Test SecurePi Connection' }));

    expect(await screen.findByText('SecurePi connected')).toBeInTheDocument();
    expect(securePiFetch.mock.calls.map(([url]) => url)).toEqual([
      'http://securepi.local:5001/health',
      'http://securepi.local:5001/people-count',
    ]);
    expect(screen.getByText(/Resolved port/).parentElement).toHaveTextContent('5001');
    expect(screen.getByText(/confirms only that the local HTTP service is reachable/i)).toBeInTheDocument();
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.put).not.toHaveBeenCalled();
    for (const [, options] of securePiFetch.mock.calls) {
      expect(options.credentials).toBe('omit');
      expect(options.headers).toBeUndefined();
      expect(JSON.stringify(options)).not.toContain('cloud-jwt-used-only-for-flowguard');
    }
  });

  test('rejects a secret-bearing URL before any local request', async () => {
    renderPage();
    await screen.findByText(/No cameras in inventory yet/);
    selectCustomSource();
    fireEvent.change(screen.getByLabelText('Stream URL'), {
      target: { value: 'http://securepi.local:5001/video_feed?api_key=secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test SecurePi Connection' }));

    expect(await screen.findByText('Invalid SecurePi URL')).toBeInTheDocument();
    expect(screen.getByText(/must not contain tokens, credentials, or secrets/i)).toBeInTheDocument();
    expect(securePiFetch).not.toHaveBeenCalled();
  });

  test('shows a stale frame as degraded service reachability', async () => {
    securePiFetch
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }))
      .mockResolvedValueOnce(jsonResponse({ count: 0, detection_active: false, age_seconds: 18 }));
    renderPage();
    await screen.findByText(/No cameras in inventory yet/);
    selectCustomSource();
    fireEvent.change(screen.getByLabelText('Stream URL'), { target: { value: 'https://securepi.local/video_feed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test SecurePi Connection' }));

    expect(await screen.findByText('SecurePi responding but frame is stale')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Frame age/).parentElement).toHaveTextContent('18s'));
  });
});
