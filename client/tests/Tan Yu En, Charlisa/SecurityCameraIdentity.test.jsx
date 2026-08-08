import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import '@testing-library/jest-dom';
import axios from 'axios';
import SecurityCamera from '../../src/pages/SecurityCamera';

vi.mock('axios');
vi.mock('../../src/components/Sidebar', () => ({ default: () => null }));

const mockAlerts = [
  {
    id: 101,
    zone_name: 'Restricted Storage A',
    camera_location: 'Storage Cam 01',
    status: 'Active',
    object_class: 'person',
    alert_type: 'Restricted-Zone Motion',
    severity: 'High',
    person_name: 'Felicia',
    identity_status: 'VERIFIED',
    person_role: 'Staff',
    track_id: 3,
    confidence: 0.94,
    device_id: 'securepi-storage-01',
    sensor_metadata: {
      pir: true,
      motion: true,
      distance_cm: 42.5,
      distance_change_cm: 77.5,
      trigger: 'PIR',
      after_hours: true,
      identity_status: 'VERIFIED',
      person_role: 'Staff',
      track_id: 3,
    },
    occurred_at: '2026-08-08T04:00:00.000Z',
  },
  {
    id: 102,
    zone_name: 'Restricted Storage A',
    camera_location: 'Storage Cam 01',
    status: 'Active',
    object_class: 'person',
    alert_type: 'Restricted-Zone Motion',
    severity: 'Critical',
    person_name: 'Unknown Person',
    identity_status: 'SUSPICIOUS',
    track_id: 7,
    confidence: 0.88,
    sensor_metadata: {
      pir: true,
      distance_cm: 50.0,
      trigger: 'Ultrasonic',
      after_hours: true,
      identity_status: 'SUSPICIOUS',
    },
    occurred_at: '2026-08-08T04:10:00.000Z',
  },
  {
    id: 103,
    zone_name: 'Restricted Storage A',
    camera_location: 'Storage Cam 01',
    status: 'Active',
    object_class: 'person',
    alert_type: 'Restricted-Zone Motion',
    severity: 'High',
    person_name: null,
    identity_status: 'UNAVAILABLE',
    track_id: 2,
    sensor_metadata: {
      pir: true,
      identity_status: 'UNAVAILABLE',
    },
    occurred_at: '2026-08-08T04:20:00.000Z',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('accessToken', 'test-jwt');
  axios.get.mockImplementation((url) => {
    if (url === '/api/zones') return Promise.resolve({ data: [] });
    if (url === '/api/cameras') return Promise.resolve({ data: [{ id: 1, camera_code: 'CAM-01', camera_name: 'Storage Cam 01' }] });
    if (url === '/api/detection-alerts') return Promise.resolve({ data: mockAlerts });
    if (url === '/api/yolo/people-count') return Promise.resolve({ data: { count: 1, detection_active: true } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderPage = () => render(<MemoryRouter><SecurityCamera /></MemoryRouter>);

describe('SecurityCamera Identity & Sensor UI Rendering', () => {
  test('renders VERIFIED person alert with identity, role, classification, PIR, ultrasonic, track ID, and WhatsApp', async () => {
    renderPage();

    expect(await screen.findByText('Security Camera')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText('Felicia (VERIFIED)').length).toBeGreaterThan(0);
    });

    const body = screen.getAllByText('Felicia (VERIFIED)')[0].closest('.od-incident-body');
    expect(body).toHaveTextContent('Identity Felicia (VERIFIED)');
    expect(body).toHaveTextContent('Role Staff');
    expect(body).toHaveTextContent('Classification VERIFIED');
    expect(body).toHaveTextContent('Track ID 3');
    expect(body).toHaveTextContent('PIR ACTIVE');
    expect(body).toHaveTextContent('Ultrasonic 43 cm');
    expect(body).toHaveTextContent('Distance Change 78 cm');
    expect(body).toHaveTextContent('Sensor Trigger PIR');
    expect(body).toHaveTextContent('After Hours ACTIVE');
    expect(body).toHaveTextContent('Confidence 94%');
  });

  test('renders UNAVAILABLE identity without converting it into UNKNOWN', async () => {
    axios.get.mockImplementation((url) => {
      if (url === '/api/zones') return Promise.resolve({ data: [] });
      if (url === '/api/cameras') return Promise.resolve({ data: [{ id: 1, camera_code: 'CAM-01', camera_name: 'Storage Cam 01' }] });
      if (url === '/api/detection-alerts') return Promise.resolve({ data: [mockAlerts[2]] });
      if (url === '/api/yolo/people-count') return Promise.resolve({ data: { count: 0, detection_active: false } });
      return Promise.reject(new Error(`unexpected GET ${url}`));
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getAllByText('UNAVAILABLE').length).toBeGreaterThan(0);
    });

    const body = screen.getAllByText('UNAVAILABLE')[0].closest('.od-incident-body');
    expect(body).not.toHaveTextContent('Unknown Person');
    expect(body).not.toHaveTextContent('UNKNOWN');
  });
});
