# Codex project instructions

Before work, read `AGENT.md`, then follow its required project memory and context read order. Treat `AGENT.md`, `CLAUDE.md`, `docs/memory/project.md`, `PROGRESS.md`, and `ARCHITECTURE-ESSENTIALS.md` as the project context sources; preserve existing work and respect the phase approval process.

For interface design, implementation, or review, use the `ui-ux-pro-max` skill. Read `DESIGN.md` and `docs/pages.md` first and treat their Kleeno brand and product rules as authoritative. Use the skill to improve layout, hierarchy, responsiveness, accessibility, and interaction quality; do not invent user research or preferences. Ask the product owner when a visual direction is not established by the existing design docs.

Motion is installed as the `motion` package (`motion/react`). Follow `DESIGN.md`: use CSS transitions by default, use Motion for interactions CSS cannot express cleanly, keep transitions within the documented timing range, and honor reduced-motion preferences. Do not add motion to approval, money, or other decision surfaces.

MotionSites is an external design-reference catalog, not a package dependency. Use references only to inform layout and interaction; do not copy another product's brand. Save a `reference-prompt.md` only after a specific reference and direction are selected.
