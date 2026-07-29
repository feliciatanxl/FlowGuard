import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import HashScrollHandler from '../src/components/HashScrollHandler';
import NavBar from '../src/components/NavBar';

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}{location.hash}</output>;
};

const HomeFixture = () => (
  <>
    <NavBar />
    <section id="mission">Mission</section>
    <section id="how-it-works">How it works</section>
    <section id="capabilities">Capabilities</section>
    <section id="poc-status">PoC status</section>
  </>
);

const renderNavigation = (initialEntry) => render(
  <MemoryRouter initialEntries={[initialEntry]}>
    <HashScrollHandler />
    <LocationProbe />
    <Routes>
      <Route path="/" element={<HomeFixture />} />
      <Route path="/innovation" element={<NavBar />} />
    </Routes>
  </MemoryRouter>,
);

describe('hash navigation', () => {
  let scrollIntoView;
  let originalAnimationFrame;
  let originalCancelAnimationFrame;
  let originalScrollIntoView;

  beforeAll(() => {
    originalAnimationFrame = Object.getOwnPropertyDescriptor(window, 'requestAnimationFrame');
    originalCancelAnimationFrame = Object.getOwnPropertyDescriptor(window, 'cancelAnimationFrame');
    originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');

    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback) => {
        callback();
        return 1;
      },
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      value: vi.fn(),
    });
  });

  beforeEach(() => {
    scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
  });

  afterAll(() => {
    if (originalAnimationFrame) {
      Object.defineProperty(window, 'requestAnimationFrame', originalAnimationFrame);
    } else {
      delete window.requestAnimationFrame;
    }

    if (originalCancelAnimationFrame) {
      Object.defineProperty(window, 'cancelAnimationFrame', originalCancelAnimationFrame);
    } else {
      delete window.cancelAnimationFrame;
    }

    if (originalScrollIntoView) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
    } else {
      delete HTMLElement.prototype.scrollIntoView;
    }
  });

  test('clicking Solutions opens the public Innovation page', async () => {
    renderNavigation('/');

    fireEvent.click(screen.getByRole('link', { name: 'Solutions' }));

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/innovation');
      expect(scrollIntoView).not.toHaveBeenCalled();
    });
  });

  test('a section link from another route navigates home and scrolls', async () => {
    renderNavigation('/innovation');

    fireEvent.click(screen.getByRole('link', { name: 'How It Works' }));

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/#how-it-works');
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
      expect(scrollIntoView.mock.instances).toContain(document.getElementById('how-it-works'));
    });
  });

  test('direct /#capabilities navigation scrolls to the canonical section', async () => {
    renderNavigation('/#capabilities');

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
      expect(scrollIntoView.mock.instances).toContain(document.getElementById('capabilities'));
    });
  });

  test('legacy /#technology navigation scrolls to capabilities', async () => {
    renderNavigation('/#technology');

    await waitFor(() => {
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
      expect(scrollIntoView.mock.instances).toContain(document.getElementById('capabilities'));
    });
  });

  test('clicking the current capability hash scrolls again', async () => {
    renderNavigation('/#capabilities');
    scrollIntoView.mockClear();

    fireEvent.click(screen.getByRole('link', { name: 'Capabilities' }));

    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('/#capabilities');
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
      expect(scrollIntoView.mock.instances).toContain(document.getElementById('capabilities'));
    });
  });

  test('a missing hash target causes no crash', () => {
    renderNavigation('/#missing-section');

    expect(screen.getByTestId('location').textContent).toBe('/#missing-section');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  test('navigation links preserve their labels and destinations', () => {
    renderNavigation('/');

    expect(screen.getByRole('link', { name: 'Solutions' }).getAttribute('href')).toBe('/innovation');
    expect(screen.getByRole('link', { name: 'How It Works' }).getAttribute('href')).toBe('/#how-it-works');
    expect(screen.getByRole('link', { name: 'Capabilities' }).getAttribute('href')).toBe('/#capabilities');
    expect(screen.getByRole('link', { name: 'PoC Status' }).getAttribute('href')).toBe('/#poc-status');
  });
});
