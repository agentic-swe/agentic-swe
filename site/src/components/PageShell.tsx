import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import { motion } from 'framer-motion'
import logoMarkSrc from '../assets/logo-mark.svg?url'
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
            <img
              className="logo-mark"
              src={logoMarkSrc}
              alt=""
              width={32}
              height={32}
              decoding="async"
            />
            <span className="logo-wordmark">
              agentic<span>SWE</span>
            </span>
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
            <NavLink to="/" end className={navClass} onClick={() => setMenuOpen(false)}>
              Home
            </NavLink>
            <NavLink to="/capabilities" className={navClass} onClick={() => setMenuOpen(false)}>
              Capabilities
            </NavLink>
            <NavLink to="/docs/installation" className={navClass} onClick={() => setMenuOpen(false)}>
              Installation
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
            &nbsp;&middot;&nbsp; <Link to="/documentation">Documentation</Link>
            &nbsp;&middot;&nbsp; <Link to="/support">Support</Link>
            &nbsp;&middot;&nbsp;
            <a href="https://github.com/surajSFDC/agentic-swe" target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            &nbsp;&middot;&nbsp; MIT
            &nbsp;&middot;&nbsp; Suraj Gupta
          </p>
        </motion.footer>
      </div>
    </>
  )
}
