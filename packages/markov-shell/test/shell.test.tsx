import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Compass, House } from 'lucide-react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CompanionPresence,
  FOCUS_PREFERENCE_KEY,
  isCurrentNavigationItem,
  MarkovShell,
  type NavigationItem,
  PixelEyes,
  type RenderLink,
  TopBar,
  useShellMode,
} from '../src/index';

const items: NavigationItem[] = [
  { key: 'home', label: 'Home', href: '/', icon: House, match: 'exact' },
  { key: 'explore', label: 'Explore', href: '/explore', icon: Compass, match: 'prefix' },
];

const renderLink: RenderLink = ({ href, className, children, ...rest }) => (
  <a href={href} className={className} aria-current={rest['aria-current']}>
    {children}
  </a>
);

function FocusToggle() {
  const { focus, setFocus, mode } = useShellMode();
  return (
    <button type="button" onClick={() => setFocus(!focus)} data-mode={mode}>
      {focus ? 'Leave focus' : 'Focus'}
    </button>
  );
}

function renderShell(currentPath = '/explore/abc') {
  return render(
    <MarkovShell
      mode={currentPath === '/' ? 'companion' : 'workspace'}
      currentPath={currentPath}
      items={items}
      renderLink={renderLink}
      topBar={
        <TopBar
          title="Explore"
          status={<span>No backend connected</span>}
          account={<FocusToggle />}
        />
      }
      dock={<CompanionPresence status="Markov is ready" />}
    >
      <h1>Workspace</h1>
    </MarkovShell>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('MarkovShell', () => {
  it('renders landmarks, a skip link and marks the current navigation item', () => {
    renderShell();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getAllByRole('navigation', { name: 'Primary' })).toHaveLength(2);
    const exploreLinks = screen.getAllByRole('link', { name: 'Explore' });
    for (const link of exploreLinks) {
      expect(link).toHaveAttribute('aria-current', 'page');
    }
    for (const link of screen.getAllByRole('link', { name: 'Home' })) {
      expect(link).not.toHaveAttribute('aria-current');
    }
    expect(screen.getByRole('banner')).toHaveTextContent('Explore');
    expect(screen.getByRole('status')).toHaveTextContent('Markov is ready');
  });

  it('exposes the presentation mode on the frame and never on the content', () => {
    const { container } = renderShell('/');
    const frame = container.querySelector('.markov-frame');
    expect(frame).toHaveAttribute('data-mode', 'companion');
    expect(frame).toHaveAttribute('data-focus', 'false');
  });

  it('persists the focus preference per viewer and survives a remount', async () => {
    const user = userEvent.setup();
    const first = renderShell();
    await user.click(screen.getByRole('button', { name: 'Focus' }));
    expect(first.container.querySelector('.markov-frame')).toHaveAttribute('data-focus', 'true');
    expect(window.localStorage.getItem(FOCUS_PREFERENCE_KEY)).toBe('true');
    first.unmount();
    const second = renderShell();
    await screen.findByRole('button', { name: 'Leave focus' });
    expect(second.container.querySelector('.markov-frame')).toHaveAttribute('data-focus', 'true');
  });

  it('keeps working when storage throws', async () => {
    const user = userEvent.setup();
    const original = window.localStorage.setItem.bind(window.localStorage);
    window.localStorage.setItem = () => {
      throw new Error('blocked');
    };
    try {
      const { container } = renderShell();
      await user.click(screen.getByRole('button', { name: 'Focus' }));
      expect(container.querySelector('.markov-frame')).toHaveAttribute('data-focus', 'true');
    } finally {
      window.localStorage.setItem = original;
    }
  });
});

describe('navigation matching and eyes', () => {
  it('matches exact and prefix routes without confusing static and dynamic segments', () => {
    expect(isCurrentNavigationItem(items[0] as NavigationItem, '/')).toBe(true);
    expect(isCurrentNavigationItem(items[0] as NavigationItem, '/explore')).toBe(false);
    expect(isCurrentNavigationItem(items[1] as NavigationItem, '/explore/abc')).toBe(true);
    expect(isCurrentNavigationItem(items[1] as NavigationItem, '/explorer')).toBe(false);
  });

  it('draws the eyes as decorative SVG with the status text as the accessible source', () => {
    const { container } = render(
      <CompanionPresence status="Markov is ready" size="hero" expression="attention" />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('data-expression', 'attention');
    expect(container.querySelectorAll('rect').length).toBeGreaterThan(40);
    expect(screen.getByRole('status')).toHaveTextContent('Markov is ready');
    render(<PixelEyes expression="muted" size="compact" />);
    expect(container.querySelector('svg[data-size="hero"]')).not.toBeNull();
  });
});
