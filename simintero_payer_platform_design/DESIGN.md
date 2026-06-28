---
name: Clinical Integrity
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#45464d'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#006c49'
  on-secondary: '#ffffff'
  secondary-container: '#6cf8bb'
  on-secondary-container: '#00714d'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#001a42'
  on-tertiary-container: '#3980f4'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#d8e2ff'
  tertiary-fixed-dim: '#adc6ff'
  on-tertiary-fixed: '#001a42'
  on-tertiary-fixed-variant: '#004395'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  display:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 14px
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 16px
  margin-desktop: 32px
  margin-mobile: 16px
  container-max: 1440px
---

## Brand & Style

The design system is engineered for mission-critical healthcare operations, prioritizing **Immutability**, **Explainability**, and **Standards-Native** architecture. The brand personality is rooted in high-trust clinical professionalism, functioning less like a traditional SaaS tool and more like a high-integrity operating system for healthcare payers.

The visual direction utilizes a **Corporate / Modern** aesthetic with elements of **Minimalism** to ensure data density remains legible. The interface must feel intentional and grounded, evoking an emotional response of absolute reliability and technical authority. Every UI element exists to surface evidence and maintain the "system of record" integrity, avoiding decorative flourishes in favor of functional precision.

## Colors

The palette is anchored by **Deep Navy (#0F172A)**, used for structural navigation and primary headers to establish institutional authority. **Compliance Green (#10B981)** is reserved strictly for successful validations, approvals, and immutable "true" states, providing a high-trust signal for regulatory workflows. 

**Intelligence Blue (#3B82F6)** identifies AI-generated insights, explainability layers, and dynamic logic. The background is built on a **Slate Gray base (#F8FAFC)** to reduce eye strain during long-form data review while maintaining a clinical, "cleanroom" environment. Semantic colors for warnings (Amber) and errors (Rose) should follow a muted, professional tone to avoid alarmism.

## Typography

This design system utilizes **Inter** for all primary interface text to ensure maximum legibility and a systematic feel. A secondary monospaced font, **JetBrains Mono**, is introduced for "Rule Badges," ID strings, and audit trail timestamps to reinforce the "Standards-Native" and technical nature of the data.

Typography is scaled to support high data density. Headlines use tighter letter spacing for a more authoritative, "official" appearance. Label styles are frequently used for metadata and status indicators, ensuring that even at small sizes, the system's "explainable" logic remains readable.

## Layout & Spacing

The layout follows a **Fixed Grid** model for desktop dashboards to ensure that complex data tables and "Evidence Cards" remain in predictable positions for power users. A 12-column grid is used with a 16px gutter. 

Spacing follows a strict 4px base unit. For data-heavy views, use compact padding (8px or 12px) to maximize information density. For high-level oversight views, use more generous spacing (24px+) to create a sense of calm and clarity. Content reflows for mobile by collapsing sidebar navigation into a bottom-anchored bar or a "Universal Search" trigger.

## Elevation & Depth

This design system uses **Low-contrast outlines** combined with **Tonal layers** to establish hierarchy. Avoid heavy drop shadows which can feel too "consumer-grade" and cluttered. 

- **Level 0 (Surface):** The primary background (#F8FAFC).
- **Level 1 (Cards/Containers):** Pure white (#FFFFFF) with a 1px border in a subtle slate (#E2E8F0).
- **Level 2 (Active/Pop-over):** Subtle ambient shadow (0px 4px 12px rgba(15, 23, 42, 0.05)) to indicate focus.

Depth is used primarily to indicate the "stacking" of evidence. When a user clicks an "Intelligence Blue" feature to see an explanation, the explainability layer should slide over or appear as a distinct tonal tier.

## Shapes

The shape language is **Soft (0.25rem)**. This provides a professional, modern feel without the playfulness of fully rounded corners. 

- **Standard Elements:** 4px radius (Buttons, Inputs, Rule Badges).
- **Evidence Cards:** 8px radius (Large containers).
- **Universal Timelines:** Straight lines with 4px radius nodes to emphasize a linear, immutable path.

Buttons and badges should maintain a crisp, structural appearance to reflect the precision of healthcare standards.

## Components

### Evidence Cards
The primary container for decision-making data. They must feature a header with a "Rule Badge" and a footer containing a "Source Link" or "Standard Reference." Background is white with a Slate-200 border.

### Universal Timelines
A vertical or horizontal track representing the lifecycle of a claim or record. Nodes are color-coded based on status (Compliance Green, Intelligence Blue, or Deep Navy). Each node must be clickable to reveal the underlying evidence.

### Rule Badges
Small, high-contrast indicators using **JetBrains Mono**. These display the specific regulatory code (e.g., "HIPAA-270") or internal logic rule. 

### Buttons
- **Primary:** Deep Navy background, white text. No gradients.
- **AI/Intelligence:** Intelligence Blue background with a subtle "spark" icon.
- **Ghost:** Slate-600 text, no background, used for secondary actions.

### Input Fields
Strictly defined with a 1px border. Focus state uses a 2px "Intelligence Blue" ring to signify the active entry point for the "system of record."

### Checkboxes & Radio Buttons
Standardized square (checkbox) and circle (radio) shapes using the Deep Navy for active states, ensuring high contrast against the slate background.