import { Link, useLocation } from 'react-router';
import LogoIcon from './LogoIcon';

const NavBar = () => {
  const { pathname } = useLocation();
  const isInnovationPage = pathname === '/innovation';
  const publicLinks = isInnovationPage
    ? {
        solutions: '/innovation#solutions',
        capabilities: '/innovation#capabilities',
        howItWorks: '/innovation#how-it-works',
        pocStatus: '/innovation#poc-status',
      }
    : {
        solutions: '/innovation',
        capabilities: '/#capabilities',
        howItWorks: '/#how-it-works',
        pocStatus: '/#poc-status',
      };

  return (
    <nav className="navbar-container" aria-label="Primary navigation">
      <Link to="/" className="nav-logo" aria-label="FlowGuard home">
        <LogoIcon size={32} />
        <span>FlowGuard</span>
      </Link>
      <div className="nav-right-section">
        <div className="nav-links">
          <Link
            to={publicLinks.solutions}
            className={isInnovationPage ? 'is-active' : undefined}
            aria-current={isInnovationPage ? 'page' : undefined}
          >
            Solutions
          </Link>
          <Link to={publicLinks.capabilities}>Capabilities</Link>
          <Link to={publicLinks.howItWorks}>How It Works</Link>
          <Link to={publicLinks.pocStatus}>PoC Status</Link>
        </div>
        <Link to="/login" className="nav-login-btn">Client Login</Link>
      </div>
    </nav>
  );
};

export default NavBar;
