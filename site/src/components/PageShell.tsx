import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { motion } from 'framer-motion'
import { AmbientBackground } from './AmbientBackground'

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'nav-active' : undefined

export function PageShell() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <>
      <AmbientBackground />
      <div className="content-wrap">
        <nav>
          <Link to="/" className="logo" onClick={() => setMenuOpen(false)}>
            agentic<span>SWE</span>
          </Link>
          <button
            type="button"
            className="mobile-toggle"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-label="Toggle menu"
          >
            &#9776;
          </button>
          <div className={`nav-links${menuOpen ? ' open' : ''}`}>
            <NavLink to="/capabilities" className={navClass} onClick={() => setMenuOpen(false)}>
              Capabilities
            </NavLink>
            <NavLink to="/docs/installation" className={navClass} onClick={() => setMenuOpen(false)}>
              Installation
            </NavLink>
            <NavLink to="/guide" className={navClass} onClick={() => setMenuOpen(false)}>
              Guide
            </NavLink>
            <NavLink to="/documentation" className={navClass} onClick={() => setMenuOpen(false)}>
              Documentation
            </NavLink>
            <NavLink to="/support" className={navClass} onClick={() => setMenuOpen(false)}>
              Support
            </NavLink>
            <a
              href="https://github.com/surajSFDC/agentic-swe"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
            >
              GitHub
            </a>
          </div>
        </nav>

        <Outlet />

        <motion.footer
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-20px' }}
          transition={{ duration: 0.45 }}
        >
          <p>
            <Link to="/">Home</Link>
            &nbsp;&middot;&nbsp; <Link to="/capabilities">Capabilities</Link>
            &nbsp;&middot;&nbsp; <Link to="/docs/installation">Installation</Link>
            &nbsp;&middot;&nbsp; <Link to="/guide">Guide</Link>
            &nbsp;&middot;&nbsp; <Link to="/documentation">Documentation</Link>
            &nbsp;&middot;&nbsp; <Link to="/support">Support</Link>
            &nbsp;&middot;&nbsp;
            <a href="https://github.com/surajSFDC/agentic-swe" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            &nbsp;&middot;&nbsp; MIT
            &nbsp;&middot;&nbsp; Suraj Gupta
          </p>
          <p style={{ marginTop: '0.75rem', fontSize: '0.78rem' }}>
            More detail:{' '}
            <Link to="/docs/installation">Installation</Link> · <Link to="/docs/usage">Usage</Link> ·{' '}
            <Link to="/docs/examples">Examples</Link> · <Link to="/docs/claude-code-plugin">Claude Code plugin</Link>
          </p>
        </motion.footer>
      </div>
    </>
  )
}
