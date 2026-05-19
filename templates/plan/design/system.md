# Design System Document

> Created by SpecFuse on {{date}}
> Edit this document directly. Run `specfuse sync` to propagate design constraints to .specfuse/constitution.md.

---

## Design Tokens

- Define token usage constraints, not raw token inventories.
- *(e.g. Use semantic color tokens only — no hard-coded hex values in components.)*
- *(e.g. Typography must use approved text styles and responsive scale tokens.)*

## Component Standards

- *(e.g. Prefer shared button, input, modal, and table primitives before custom UI.)*
- *(e.g. Destructive actions require explicit confirmation states.)*
- *(e.g. Empty, loading, and error states are required for every async view.)*

## Accessibility Rules

- *(e.g. Minimum touch target 44×44px.)*
- *(e.g. Colour contrast must be at least 4.5:1 for normal text.)*
- *(e.g. All interactive controls require visible focus states.)*

## Layout Constraints

- *(e.g. Use the spacing scale — no ad-hoc pixel values outside approved exceptions.)*
- *(e.g. Primary content width must remain readable on large screens.)*
- *(e.g. Forms should avoid more than one scroll container per screen.)*

## Motion & Animation

- *(e.g. Motion must communicate state changes only — never be decorative by default.)*
- *(e.g. All motion must respect reduced motion preferences.)*
- *(e.g. Auto-playing animation must be pausable or disableable.)*
