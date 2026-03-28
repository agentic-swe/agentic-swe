# Frontend Aesthetics Reference

Source: [Anthropic Claude Cookbooks — Prompting for Frontend Aesthetics](https://github.com/anthropics/claude-cookbooks/blob/main/coding/prompting_for_frontend_aesthetics.ipynb)

This reference defines the aesthetic standards all frontend-generating agents must follow. The goal is to produce visually distinctive, polished frontends instead of generic "AI slop" designs.

## Distilled Aesthetics Prompt

All frontend agents must include this prompt context when generating UI code:

```
<frontend_aesthetics>
You tend to converge toward generic, "on distribution" outputs. In frontend design, this creates what users call the "AI slop" aesthetic. Avoid this: make creative, distinctive frontends that surprise and delight. Focus on:

Typography: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics.

Color & Theme: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes. Draw from IDE themes and cultural aesthetics for inspiration.

Motion: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions.

Backgrounds: Create atmosphere and depth rather than defaulting to solid colors. Layer CSS gradients, use geometric patterns, or add contextual effects that match the overall aesthetic.

Avoid generic AI-generated aesthetics:
- Overused font families (Inter, Roboto, Arial, system fonts)
- Cliche color schemes (particularly purple gradients on white backgrounds)
- Predictable layouts and component patterns
- Cookie-cutter design that lacks context-specific character

Interpret creatively and make unexpected choices that feel genuinely designed for the context. Vary between light and dark themes, different fonts, different aesthetics.
</frontend_aesthetics>
```

## Typography Guide

### Never Use
Inter, Roboto, Open Sans, Lato, Arial, default system fonts

### Recommended Font Choices

| Context | Fonts |
|---------|-------|
| Code / Technical | JetBrains Mono, Fira Code, Space Grotesk |
| Editorial / Content | Playfair Display, Crimson Pro, Fraunces |
| Startup / Modern | Clash Display, Satoshi, Cabinet Grotesk |
| Distinctive / Unique | Bricolage Grotesque, Obviously, Newsreader |

### Pairing Principle
High contrast = interesting. Pair display + monospace, serif + geometric sans. Use weight extremes (100/200 vs 800/900), not timid mid-range differences (400 vs 600).

## Color & Theme Guide

- Commit to a cohesive aesthetic — don't mix conflicting styles
- Use CSS variables for consistency across the design
- Dominant colors with sharp accents outperform timid, evenly-distributed palettes
- Draw inspiration from IDE themes (Dracula, Nord, Solarized, Tokyo Night) and cultural aesthetics (Solarpunk, Brutalism, Art Deco)
- Avoid: purple gradients on white backgrounds (the most cliched AI-generated look)

## Motion Guide

- CSS-only animations for vanilla HTML projects
- Motion library (Framer Motion) for React projects when available
- Focus on high-impact moments: one well-orchestrated page load with staggered reveals (`animation-delay`) > scattered micro-interactions
- Use `animation-delay` for staggered entrance effects
- Keep animations purposeful — every animation should communicate something

## Background Guide

- Create atmosphere and depth — never default to flat solid colors
- Layer CSS gradients for richness
- Use geometric patterns or noise textures for character
- Add contextual effects that match the overall aesthetic
- Consider subtle animated backgrounds for hero sections

## Theme Examples

### Solarpunk
Warm, optimistic palettes (greens, golds, earth tones). Organic shapes mixed with technical elements. Nature-inspired patterns. Bright, hopeful atmosphere. Retro-futuristic typography.

### Brutalist
Raw, honest materials. High contrast. Monospace typography. Minimal decoration. Strong grid systems. Intentionally rough edges.

### Art Deco
Geometric patterns. Gold and jewel tones. Elegant serif fonts. Symmetry and luxury. Ornamental borders.

## Application Rules

1. Always load distinctive fonts from Google Fonts (or equivalent CDN)
2. State font and theme choices before writing code
3. Use CSS variables for all colors, spacing, and typography values
4. Vary between light and dark themes across different projects
5. Each project should have a unique visual identity — no two should look alike
