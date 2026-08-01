// Incident Dashboard side-panel — display of the linked edge DetectionAlert.
// Verifies that opening an incident that has a linked detection alert shows the rich
// edge fields (object class `rat`, confidence, device id, zone) and renders a remote
// snapshot as a link but a Raspberry Pi LOCAL path as a note (never a link). Also
// confirms incidents WITHOUT a linked alert (facial recognition) still render.
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import '@testing-library/jest-dom';

vi.mock('axios');
vi.mock('../../src/components/Sidebar', () => ({ default: () => null }));

let axios;
let IncidentDashboard;

const load = async () => {
  vi.resetModules();
  axios = (await import('axios')).default;
  ({ default: IncidentDashboard } = await import('../../src/pages/IncidentDashboard'));
};

const mockIncidents = (incidents) => {
  axios.get.mockImplementation((url) => {
    if (String(url).startsWith('/api/incident')) return Promise.resolve({ data: incidents });
    return Promise.resolve({ data: [] });
  });
  axios.patch.mockResolvedValue({ data: {} });
  axios.delete.mockResolvedValue({ data: {} });
};

const renderPage = () => render(<MemoryRouter><IncidentDashboard /></MemoryRouter>);

const ratIncident = {
  id: 1,
  createdAt: '2026-07-29T08:46:00Z',
  camera_location: 'Kitchen Camera 01',
  status: 'PEST_DETECTION',
  person_name: null,
  confidence_score: null,
  severity: 'High',
  source: 'SecurePi Edge Node',
  resolutionStatus: 'Active',
  notes: '[Object Detection] Zone: Kitchen',
  detectionAlert: {
    id: 55,
    object_class: 'rat',
    alert_type: 'Pest Detection',
    confidence: 0.92,
    zone_name: 'Kitchen',
    camera_location: 'Kitchen Camera 01',
    device_id: 'securepi-kitchen-01',
    duration_seconds: null,
    source: 'SecurePi Edge Node',
    occurred_at: '2026-07-29T08:46:00Z',
    snapshot_url: 'https://cloud.example/api/edge/snapshots/edge_abc.jpg', // remote -> link
  },
};

const localSnapshotIncident = {
  ...ratIncident,
  id: 2,
  detectionAlert: { ...ratIncident.detectionAlert, snapshot_url: 'runtime/snapshots/kitchen/pest_rat_4.jpg' },
};

const faceIncident = {
  id: 3,
  createdAt: '2026-07-29T09:00:00Z',
  camera_location: 'Lobby Camera 02',
  status: 'UNAUTHORIZED_ACCESS',
  person_name: 'Jane Doe',
  confidence_score: 0.81,
  severity: 'Critical',
  source: 'Facial Recognition',
  resolutionStatus: 'Active',
  notes: '',
  detectionAlert: null, // no linked edge alert
};

const openFirstIncident = async () => {
  renderPage();
  const viewBtn = await screen.findByRole('button', { name: /view/i });
  fireEvent.click(viewBtn);
  return screen.findByText('Incident Report');
};

describe('Incident side panel — edge detection details', () => {
  beforeEach(async () => {
    await load();
  });

  test('shows the rat object class, confidence, device id and zone', async () => {
    mockIncidents([ratIncident]);
    await openFirstIncident();
    const modal = document.querySelector('.inc-detail-modal');
    expect(within(modal).getByText('Edge Detection Details')).toBeInTheDocument();
    expect(within(modal).getByText('rat')).toBeInTheDocument();          // requirement: shows "rat"
    expect(within(modal).getByText('92%')).toBeInTheDocument();          // confidence 0.92 -> 92%
    expect(within(modal).getByText('securepi-kitchen-01')).toBeInTheDocument(); // device id
    expect(within(modal).getByText('Kitchen')).toBeInTheDocument();      // zone
  });

  test('renders a remote snapshot URL as a clickable link', async () => {
    mockIncidents([ratIncident]);
    await openFirstIncident();
    const link = screen.getByRole('link', { name: /open full snapshot/i });
    expect(link).toHaveAttribute('href', 'https://cloud.example/api/edge/snapshots/edge_abc.jpg');
  });

  test('never renders a Raspberry Pi local path as a link (shows a note instead)', async () => {
    mockIncidents([localSnapshotIncident]);
    await openFirstIncident();
    expect(screen.queryByRole('link', { name: /open full snapshot/i })).toBeNull();
    expect(screen.getByText(/remote upload unavailable/i)).toBeInTheDocument();
  });

  test('incident without a linked detection alert still renders (facial recognition)', async () => {
    mockIncidents([faceIncident]);
    await openFirstIncident();
    const modal = document.querySelector('.inc-detail-modal');
    // No edge section, but the panel renders normally with the face incident details.
    expect(within(modal).queryByText('Edge Detection Details')).toBeNull();
    expect(within(modal).getByText('Jane Doe')).toBeInTheDocument();
  });
});
