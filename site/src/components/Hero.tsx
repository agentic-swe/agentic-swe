import { motion, useReducedMotionConfig } from 'framer-motion'
import { Link } from 'react-router-dom'

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.11, delayChildren: 0.08 },
  },
}

const item = {
  hidden: { opacity: 0, y: 28 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, ease: [0.16, 1, 0.3, 1] as const },
  },
}

export function Hero() {
  // Follows MotionConfig (see App.tsx), not the raw OS media query alone.
  const hideOrbit = useReducedMotionConfig() === true

  return (
    <section className="hero hero--motion">
      {!hideOrbit && (
        <div className="hero-orbit" aria-hidden>
          <motion.span
            className="hero-orbit__ring hero-orbit__ring--outer"
            animate={{ rotate: 360 }}
            transition={{ duration: 120, repeat: Infinity, ease: 'linear' }}
          />
          <motion.span
            className="hero-orbit__ring hero-orbit__ring--inner"
            animate={{ rotate: -360 }}
            transition={{ duration: 90, repeat: Infinity, ease: 'linear' }}
          />
        </div>
      )}

      <motion.div
        className="hero-inner"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <motion.div className="hero-badge" variants={item}>
          <span className="dot" />
          Hypervisor policy · pure markdown · no cloud runtime
        </motion.div>
        <motion.h1 variants={item}>
          Autonomous SWE
          <br />
          <span className="gradient-text">for Claude Code</span>
        </motion.h1>
        <motion.p variants={item}>
          A state-machine pipeline with <strong>three tracks</strong> (lean, standard, rigorous),{' '}
          <strong>human gates</strong>, and evidence-backed artifacts. Your primary session follows the{' '}
          <strong>Hypervisor</strong> policy in the repo root — plus <strong>135+</strong> auto-selected
          specialists. Zero in-repo runtime: policies, phases, and agents are markdown.
        </motion.p>
        <motion.div className="hero-actions" variants={item}>
          <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
            <Link to="/documentation" className="btn btn-primary">
              Documentation
            </Link>
          </motion.div>
          <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
            <Link to="/guide" className="btn btn-ghost">
              Read the guide
            </Link>
          </motion.div>
          <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
            <a href="#start" className="btn btn-ghost">
              Quick steps
            </a>
          </motion.div>
          <motion.div whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }}>
            <Link to="/docs/installation" className="btn btn-ghost">
              Install guide
            </Link>
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  )
}
