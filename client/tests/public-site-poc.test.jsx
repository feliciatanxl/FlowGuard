/* global process */
import '@testing-library/jest-dom/vitest';
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import fs from 'fs';
import path from 'path';
import Home from '../src/pages/Home';
import AIInnovation from '../src/pages/AIInnovation';
import SystemHealth from '../src/pages/SystemHealth';
import Contact from '../src/pages/Contact';

const renderPublic = (ui, initialEntry = '/') => render(<MemoryRouter initialEntries={[initialEntry]}>{ui}</MemoryRouter>);
const forbiddenClaims = /128\+|PPE|Spill|HVAC|temperature|humidity|99\.8|40%|70%|NexusCloud|OptiTemp|AeroNode|Sentinel Security|Available TOL 2027|Opening Soon/i;
const internalData = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}|\\+65\\s?\\d{4}\\s?\\d{4}|192\\.168\\.|10\\.0\\.|SG[A-Z0-9]{6,}|faceVector|passwordResetTokenHash/i;

describe('public FlowGuard website PoC positioning', () => {
  test('homepage module and workflow cards render as four ordered public cards', () => {
    renderPublic(<Home />);

    const moduleCards = screen.getAllByTestId('module-card');
    expect(moduleCards).toHaveLength(4);
    expect(moduleCards.map((card) => within(card).getByRole('heading').textContent)).toEqual([
      'Secure Access Management',
      'Asset and Space Monitoring',
      'Smart Logistics',
      'Incident and Operational Support'
    ]);

    const workflowSteps = screen.getAllByTestId('workflow-step');
    expect(workflowSteps).toHaveLength(4);
    expect(workflowSteps.map((card) => within(card).getByRole('heading').textContent)).toEqual([
      'Configure',
      'Monitor',
      'Verify and Respond',
      'Review'
    ]);
  });

  test('homepage hero has platform and client-login actions', () => {
    renderPublic(<Home />);

    const hero = within(screen.getByTestId('homepage-hero'));
    expect(hero.getByRole('link', { name: /Explore the Platform/i })).toHaveAttribute('href', '/innovation');
    expect(hero.getByRole('link', { name: /Client Login/i })).toHaveAttribute('href', '/login');

    const nav = within(screen.getByRole('navigation', { name: /Primary navigation/i }));
    expect(nav.getByRole('link', { name: /Client Login/i })).toHaveAttribute('href', '/login');
  });

  test('homepage public platform links use Innovation and the canonical capability hash', () => {
    renderPublic(<Home />);

    const nav = within(screen.getByRole('navigation', { name: /Primary navigation/i }));
    expect(nav.getByRole('link', { name: 'Solutions' })).toHaveAttribute('href', '/innovation');
    expect(nav.getByRole('link', { name: 'Solutions' })).not.toHaveAttribute('aria-current');
    expect(nav.getByRole('link', { name: 'Capabilities' })).toHaveAttribute('href', '/#capabilities');

    const cta = within(screen.getByRole('region', { name: /See connected factory operations in action/i }));
    expect(cta.getByRole('link', { name: 'Launch Demo' })).toHaveAttribute('href', '/innovation');
    expect(cta.getByRole('link', { name: /View Capabilities/i })).toHaveAttribute('href', '/#capabilities');
    expect(cta.getByRole('link', { name: 'Client Login' })).toHaveAttribute('href', '/login');

    const assetCard = screen.getAllByTestId('module-card').find((card) => within(card).queryByRole('heading', { name: 'Asset and Space Monitoring' }));
    expect(within(assetCard).getByRole('link', { name: /Explore AI Monitoring/i })).toHaveAttribute('href', '/innovation');
    expect(screen.queryByRole('link', { name: /Explore AI Monitoring/i })).not.toHaveAttribute('href', '/object-detection');
  });

  test('homepage keeps canonical section ids, hidden legacy support and bounded section sizing', () => {
    renderPublic(<Home />);

    expect(document.getElementById('capabilities')).toBeInTheDocument();
    expect(document.getElementById('how-it-works')).toBeInTheDocument();
    expect(document.getElementById('poc-status')).toBeInTheDocument();

    const legacyAnchor = document.getElementById('technology');
    expect(legacyAnchor).toHaveClass('legacy-hash-anchor');
    expect(legacyAnchor).toHaveAttribute('aria-hidden', 'true');

    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/css/Home.css'), 'utf8');
    expect(css).toContain('--home-section-space: clamp(64px, 7vw, 104px);');
    expect(css).toContain('--home-compact-space: clamp(36px, 4vw, 64px);');
    expect(css).toMatch(/\.legacy-hash-anchor\s*\{[^}]*width:\s*0;[^}]*height:\s*0;/s);
    expect(css).not.toMatch(/\.(?:challenges|features|facility|how|roadmap)-section\s*\{[^}]*min-height:\s*100vh;/s);
  });

  test('homepage CSS defines four-two-one responsive grids for public cards', () => {
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/css/Home.css'), 'utf8');

    expect(css).toContain('.module-grid,');
    expect(css).toContain('.workflow-grid');
    expect(css).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));');
    expect(css).toContain('@media (max-width: 1099px)');
    expect(css).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(css).toContain('@media (max-width: 699px)');
    expect(css).toContain('grid-template-columns: 1fr;');
  });
  test('homepage shows academic PoC positioning, four real modules and no fake telemetry claims', () => {
    renderPublic(<Home />);

    expect(screen.getAllByText(/Academic Industry Proof of Concept/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Operational challenges FlowGuard addresses/i)).toBeInTheDocument();
    expect(screen.getByText(/Secure Access Management/i)).toBeInTheDocument();
    expect(screen.getByText(/Asset and Space Monitoring/i)).toBeInTheDocument();
    expect(screen.getAllByText(/^Smart Logistics$/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Incident and Operational Support/i)).toBeInTheDocument();
    expect(screen.getByText(/FlowGuard across the facility/i)).toBeInTheDocument();
    expect(screen.getByText(/How FlowGuard works/i)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Client Login/i }).some((link) => link.getAttribute('href') === '/login')).toBe(true);
    expect(document.body.textContent).not.toMatch(forbiddenClaims);
    expect(document.body.textContent).not.toMatch(/System Active|REAL-TIME FEED|Live Facility Telemetry|achieved|automation results/i);
    expect(document.body.textContent).not.toMatch(internalData);
  });

  test('homepage separates implemented PoC scope from future research', () => {
    renderPublic(<Home />);

    expect(screen.getByRole('heading', { name: /Implemented PoC scope/i })).toBeInTheDocument();
    expect(screen.getByText(/Object and unattended-item monitoring for supported classes/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Not implemented in the current PoC/i })).toBeInTheDocument();
    expect(screen.getByText(/Pest and animal detection/i)).toBeInTheDocument();
    expect(screen.getByText(/Multi-camera person re-identification/i)).toBeInTheDocument();
    expect(screen.getByText(/support, rather than replace, human operational and security decisions/i)).toBeInTheDocument();
  });

  test('innovation page shows four integrated capability areas and illustrative labels', () => {
    renderPublic(<AIInnovation />, '/innovation');

    expect(screen.getAllByRole('link', { name: 'Solutions' }).some((link) => link.getAttribute('aria-current') === 'page')).toBe(true);
    expect(screen.getByRole('heading', { level: 1, name: /FlowGuard AI & Operations Innovation/i })).toBeInTheDocument();
    expect(screen.getByText(/FlowGuard connects secure access, intelligent space monitoring, smart logistics and operational response in one factory-management platform/i)).toBeInTheDocument();

    const capabilitiesSection = within(screen.getByRole('region', { name: /Four operational areas, one FlowGuard platform/i }));
    expect(capabilitiesSection.getByRole('heading', { name: /Secure Access & Facial Recognition/i })).toBeInTheDocument();
    expect(capabilitiesSection.getByRole('heading', { name: /Object & Zone Monitoring/i })).toBeInTheDocument();
    expect(capabilitiesSection.getByRole('heading', { name: /^Smart Logistics$/i })).toBeInTheDocument();
    expect(capabilitiesSection.getByRole('heading', { name: /Operational Response/i })).toBeInTheDocument();
    expect(capabilitiesSection.getByText(/Three-angle enrolment/i)).toBeInTheDocument();
    expect(capabilitiesSection.getByText(/SecurePi\/IMX500 input/i)).toBeInTheDocument();
    expect(capabilitiesSection.getByText(/Browser and cloud QR fallback/i)).toBeInTheDocument();
    expect(capabilitiesSection.getByText(/Security Command Centre/i)).toBeInTheDocument();

    expect(screen.getAllByText(/Illustrative PoC View/i).length).toBe(2);
    expect(capabilitiesSection.getByRole('link', { name: /Launch Facial Recognition Demo/i })).toHaveAttribute('href', '/facial-evaluation');
    expect(capabilitiesSection.getByRole('link', { name: /Launch Object Detection Demo/i })).toHaveAttribute('href', '/object-detection');
    expect(capabilitiesSection.getByRole('link', { name: /Open Driver Pass Portal/i })).toHaveAttribute('href', '/driver-portal');
    expect(capabilitiesSection.getByRole('link', { name: /Launch Gate Verification Demo/i })).toHaveAttribute('href', '/logistics/gate-verification');
    expect(document.body.textContent).toMatch(/AI-assisted/i);
    expect(document.body.textContent).toMatch(/supported object classes/i);
    expect(document.body.textContent).toMatch(/PoC plate OCR/i);
    expect(document.body.textContent).toMatch(/simulated barrier/i);
    expect(document.body.textContent).not.toMatch(/tailgating detection|bomb identification|production-grade plate recognition|continuous person tracking|real physical barrier/i);
    expect(document.body.textContent).not.toMatch(/PPE Compliant|Spill Detected|Production Line PPE|128\+/i);
  });

  test('innovation page links to actual interfaces and separates current from future scope', () => {
    renderPublic(<AIInnovation />);

    const interfacesSection = within(screen.getByRole('region', { name: /Actual FlowGuard Interfaces/i }));
    expect(interfacesSection.getByRole('link', { name: /Open Face Enrollment/i })).toHaveAttribute('href', '/enrollment');
    expect(interfacesSection.getByRole('link', { name: /Open Gate Scanner/i })).toHaveAttribute('href', '/gate-scanner');
    expect(interfacesSection.getByRole('link', { name: /Open Object Detection/i })).toHaveAttribute('href', '/object-detection');
    expect(interfacesSection.getByRole('link', { name: /Open Gate Verification/i })).toHaveAttribute('href', '/logistics/gate-verification');
    expect(interfacesSection.getByRole('link', { name: /Open Incident Dashboard/i })).toHaveAttribute('href', '/incidents');
    expect(interfacesSection.getByText(/protected pages retain login and role checks/i)).toBeInTheDocument();

    const scopeSection = within(screen.getByRole('region', { name: /Current PoC and future deployment/i }));
    expect(scopeSection.getByText(/Facial checkpoint recognition/i)).toBeInTheDocument();
    expect(scopeSection.getByText(/Unattended-item detection for supported classes/i)).toBeInTheDocument();
    expect(scopeSection.getByText(/Google Cloud deployment/i)).toBeInTheDocument();
    expect(scopeSection.getByRole('heading', { name: /Not implemented in the current PoC/i })).toBeInTheDocument();
    expect(scopeSection.getByText(/Pest and animal detection/i)).toBeInTheDocument();
    expect(scopeSection.getByText(/Multi-camera person re-identification/i)).toBeInTheDocument();
    expect(scopeSection.getByText(/Physical gate integration/i)).toBeInTheDocument();
  });

  test('Innovation protected interface destinations retain route guards and RBAC', () => {
    const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8');
    const enrollmentRoute = appSource.slice(appSource.indexOf('path="/enrollment"'), appSource.indexOf('path="/cameras"'));
    const objectRoute = appSource.slice(appSource.indexOf('path="/object-detection"'), appSource.indexOf('path="/detection-settings"'));
    const gateScannerRoute = appSource.slice(appSource.indexOf('path="/gate-scanner"'), appSource.indexOf('path="/attendance"'));
    const gateVerificationRoute = appSource.slice(appSource.indexOf('path="/logistics/gate-verification"'), appSource.indexOf('path="/users"'));
    const facialRoute = appSource.slice(appSource.indexOf('path="/facial-evaluation"'), appSource.indexOf('path="/incidents"'));
    const incidentRoute = appSource.slice(appSource.indexOf('path="/incidents"'), appSource.indexOf('path="/tenant-management"'));

    expect(enrollmentRoute).toContain('<ProtectedRoute>');
    expect(enrollmentRoute).toContain('<FaceEnrollment />');
    expect(objectRoute).toContain('<ProtectedRoute allowedRoles={ACCESS.FM_ONLY}>');
    expect(objectRoute).toContain('<ObjectDetection />');
    expect(gateScannerRoute).toContain('<ProtectedRoute allowedRoles={ACCESS.FM_ONLY}>');
    expect(gateScannerRoute).toContain('<GateScanner />');
    expect(gateVerificationRoute).toContain('<ProtectedRoute allowedRoles={ACCESS.FM_ONLY}>');
    expect(gateVerificationRoute).toContain('<GateVerification />');
    expect(facialRoute).toContain('<ProtectedRoute allowedRoles={ACCESS.FM_ONLY}>');
    expect(facialRoute).toContain('<FacialEvaluation />');
    expect(incidentRoute).toContain('<ProtectedRoute allowedRoles={ACCESS.FM_ONLY}>');
    expect(incidentRoute).toContain('<IncidentDashboard />');
  });

  test('system health route is a platform overview without fake uptime or diagnostics links', () => {
    renderPublic(<SystemHealth />);

    expect(screen.getByRole('heading', { name: /Platform Overview/i })).toBeInTheDocument();
    expect(screen.getByText(/Facial Recognition Service/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Smart Logistics/i).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/uptime|Offline|Error|N-0|99\.9|92\.4|View Diagnostics/i);
    expect(document.body.textContent).not.toMatch(forbiddenClaims);
  });

  test('contact form is visibly demo-only, does not log personal data, and does not show fake success', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    renderPublic(<Contact />);

    expect(screen.getByText(/Demo enquiry form - no message will be transmitted/i)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Enter your full name/i), { target: { value: 'Test Person' } });
    fireEvent.change(screen.getByPlaceholderText(/name@example.com/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByPlaceholderText(/Demo enquiry details/i), { target: { value: 'Hello' } });
    fireEvent.submit(screen.getByRole('button', { name: /Review Demo Notice/i }).closest('form'));

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/Inquiry sent|sent to FlowGuard|Project HQ|flowguard\.support|Google Maps|7 Harrison/i);
    consoleSpy.mockRestore();
  });

  test('authenticated route definitions and private page imports remain present', () => {
    const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.jsx'), 'utf8');

    ['/dashboard', '/enrollment', '/cameras', '/object-detection', '/vpatrol', '/gate-scanner', '/attendance', '/users', '/security-review', '/incidents', '/support-dashboard'].forEach((route) => {
      expect(appSource).toContain(`path="${route}"`);
    });
    expect(appSource).toContain('ProtectedRoute');
    expect(appSource).toContain('ACCESS.FM_ONLY');
  });
});
