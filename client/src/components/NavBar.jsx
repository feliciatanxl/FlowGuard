import { Link } from 'react-router';
import LogoIcon from './LogoIcon';

const NavBar = () => {
  return (
    <nav className="navbar-container" aria-label="Primary navigation">
      <Link to="/" className="nav-logo" aria-label="FlowGuard home">
        <LogoIcon size={32} />
        <span>FlowGuard</span>
      </Link>
      <div className="nav-right-section">
        <div className="nav-links">
          <Link to="/#mission">Solutions</Link>
          <Link to="/#technology">Capabilities</Link>
          <Link to="/#how-it-works">How It Works</Link>
          <Link to="/#poc-status">PoC Status</Link>
        </div>
        <Link to="/login" className="nav-login-btn">Client Login</Link>
      </div>
    </nav>
  );
};

export default NavBar;
