---
name: "TRANSCAR Automotive System"
description: "High-contrast Red, Black, and White automotive design system for TRANSCAR car rental management in Blida, Algeria."
---

## Overview

TRANSCAR is an automotive fleet and rental operations platform built for a car rental agency in Blida, Algeria. Its visual identity pairs crisp white operational workspaces with obsidian black structural anchors and decisive crimson red accents. The tone is authoritative, precise, and efficient: every table, vehicle card, and financial figure is engineered for rapid scanning during daily counter operations while presenting a trustworthy, modern storefront to booking customers.

- **Style:** Corporate / Modern Automotive — crisp surfaces, sharp typographic hierarchy, high-contrast Red, Black, and White brand expression, and tabular numeric precision.
- **Default Language:** French (`Français`), with full structural readiness for English (`LTR`) and Arabic (`RTL` via `dir="rtl"`).

## Colors

The palette is anchored in **Crimson Red** (`#93000B` / `#B91C1C`), **Obsidian Black** (`#111114`), and **Pure White** (`#FFFFFF` / `#FBF8FC`). Status hues are strictly functional: Green (`success`) indicates `Disponible` vehicles and valid documents; Amber (`warning`) indicates 7-day document expiry and approaching mileage maintenance; Red (`error` / `primary`) indicates `Réservée`, `Louée`, `En maintenance`, and overdue alerts.

```yaml
colors:
  brand-black: "#111114"
  on-brand-black: "#FFFFFF"
  success: "#15803D"
  on-success: "#FFFFFF"
  success-container: "#DCFCE7"
  on-success-container: "#14532D"
  warning: "#B45309"
  on-warning: "#FFFFFF"
  warning-container: "#FEF3C7"
  on-warning-container: "#78350F"
  light:
    primary: "#93000B"
    on-primary: "#FFFFFF"
    primary-container: "#B91C1C"
    on-primary-container: "#FFCDC7"
    secondary: "#9F3F37"
    on-secondary: "#FFFFFF"
    secondary-container: "#FF897D"
    on-secondary-container: "#76211C"
    tertiary: "#00497F"
    on-tertiary: "#FFFFFF"
    tertiary-container: "#0061A6"
    on-tertiary-container: "#C1DBFF"
    error: "#BA1A1A"
    on-error: "#FFFFFF"
    error-container: "#FFDAD6"
    on-error-container: "#93000A"
    background: "#FBF8FC"
    on-background: "#1B1B1E"
    surface: "#FBF8FC"
    surface-dim: "#DCD9DD"
    surface-bright: "#FFFFFF"
    surface-container-lowest: "#FFFFFF"
    surface-container-low: "#F6F2F7"
    surface-container: "#F0EDF1"
    surface-container-high: "#EAE7EB"
    surface-container-highest: "#E4E1E6"
    on-surface: "#1B1B1E"
    surface-variant: "#FFDAD6"
    on-surface-variant: "#5B403D"
    outline: "#8F6F6C"
    outline-variant: "#E4BEB9"
    inverse-surface: "#303033"
    inverse-on-surface: "#F3F0F4"
    inverse-primary: "#FFB4AB"
  dark:
    primary: "#FFB4AB"
    on-primary: "#690005"
    primary-container: "#B91C1C"
    on-primary-container: "#FFCDC7"
    secondary: "#FFB4AB"
    on-secondary: "#61110F"
    secondary-container: "#802822"
    on-secondary-container: "#FF9A8E"
    tertiary: "#A0CAFF"
    on-tertiary: "#003259"
    tertiary-container: "#0061A6"
    on-tertiary-container: "#C1DBFF"
    error: "#FFB4AB"
    on-error: "#690005"
    error-container: "#93000A"
    on-error-container: "#FFDAD6"
    background: "#131316"
    on-background: "#E4E1E6"
    surface: "#131316"
    surface-dim: "#131316"
    surface-bright: "#39393C"
    surface-container-lowest: "#0E0E11"
    surface-container-low: "#1B1B1E"
    surface-container: "#1F1F22"
    surface-container-high: "#2A2A2D"
    surface-container-highest: "#353438"
    on-surface: "#E4E1E6"
    surface-variant: "#5B403D"
    on-surface-variant: "#E4BEB9"
    outline: "#AB8985"
    outline-variant: "#5B403D"
    inverse-surface: "#E4E1E6"
    inverse-on-surface: "#303033"
    inverse-primary: "#B91C1C"
```

## Typography

**Wix Madefor Display** drives headlines and KPI figures with geometric precision. **Instrument Sans** handles all navigation, forms, and operational tables with clean legibility. **Source Code Pro** formats Algerian vehicle registration plates (`04582-119-09`), contract IDs, and DZD currency amounts (`tabular-nums`).

```yaml
typography:
  display-lg:
    fontFamily: "Wix Madefor Display"
    fontSize: 40px
    fontWeight: 700
    lineHeight: 48px
    letterSpacing: -0.5px
  display-lg-mobile:
    fontFamily: "Wix Madefor Display"
    fontSize: 28px
    fontWeight: 700
    lineHeight: 34px
    letterSpacing: -0.25px
  headline-lg:
    fontFamily: "Wix Madefor Display"
    fontSize: 28px
    fontWeight: 700
    lineHeight: 36px
    letterSpacing: -0.25px
  headline-md:
    fontFamily: "Wix Madefor Display"
    fontSize: 22px
    fontWeight: 600
    lineHeight: 28px
    letterSpacing: 0px
  title-lg:
    fontFamily: "Instrument Sans"
    fontSize: 18px
    fontWeight: 600
    lineHeight: 24px
    letterSpacing: 0px
  title-md:
    fontFamily: "Instrument Sans"
    fontSize: 15px
    fontWeight: 600
    lineHeight: 20px
    letterSpacing: 0px
  body-lg:
    fontFamily: "Instrument Sans"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 22px
    letterSpacing: 0px
  body-md:
    fontFamily: "Instrument Sans"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0px
  label-lg:
    fontFamily: "Instrument Sans"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 18px
    letterSpacing: 0.1px
  label-sm:
    fontFamily: "Instrument Sans"
    fontSize: 11px
    fontWeight: 600
    lineHeight: 16px
    letterSpacing: 0.3px
  mono-md:
    fontFamily: "Source Code Pro"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 18px
    letterSpacing: 0.2px
```

## Layout & Spacing

Desktop administration screens use a persistent left navigation sidebar (`256px` wide, `brand-black` surface) paired with a fluid main workspace (`12-column` grid, `24px` page padding, `20px` card gutters). The customer booking website uses a centered `1200px` max-width grid with a top navigation bar and full-width hero band. Spacing follows a strict `4px` / `8px` grid.

```yaml
spacing:
  gutter-xs: 4px
  gutter-sm: 8px
  gutter-md: 16px
  gutter-lg: 24px
  gutter-xl: 32px
  section: 40px
  page-margin: 24px
```

## Elevation & Depth

Hierarchy relies on tonal surface layering (`surface` `#FBF8FC` -> `surface-container-lowest` `#FFFFFF` cards) and crisp `1px` `outline-variant` borders rather than heavy drop shadows. Elevated overlays (modals, dropdowns, notification drawers) use a subtle, diffused ambient shadow.

## Shapes

Sharp, engineered automotive geometry: `8px` default radius for cards and inputs, `6px` for buttons and status badges, `12px` for feature containers and vehicle cards.

```yaml
rounded:
  sm: 4px
  DEFAULT: 8px
  md: 10px
  lg: 12px
  xl: 16px
  full: 9999px
```

## Motion & Micro-interaction

Interactions are crisp and immediate, matching the responsiveness of a native desktop tool.

```yaml
motion:
  state-change:
    duration: 120ms
    delay: 0ms
    timingFunction: ease-out
  surface-enter:
    duration: 200ms
    delay: 0ms
    timingFunction: cubic-bezier(0.2, 0, 0, 1)
  surface-exit:
    duration: 140ms
    delay: 0ms
    timingFunction: cubic-bezier(0.3, 0, 1, 1)
```

## Voice & Content Strategy

- **Tone:** Direct, operational, and trustworthy. Default UI language is **French** (`Parc Automobile`, `Contrats de location`, `Caisse`, `Clients`), using authentic Algerian car rental terminology (`Immatriculation`, `Assurance`, `Contrôle technique`, `Carte grise`, `Vignette`, `DZD`).
- **Action Labels:** Specific verb phrases (`+ Ajouter une voiture`, `Créer un contrat`, `Vérifier la disponibilité`). Never generic `OK` or `Submit`.
- **Numbers & Dates:** Tabular numbers (`tabular-nums`) for all DZD amounts (`6 500 DZD / jour`), mileages (`42 150 km`), and dates (`23/11/2026`).

## Components

Component implementations live as individual HTML sticker sheet files in
`components/`. Each file contains the canonical, styled HTML components with
`<!-- COMPONENT: name -->` comment markers. Read each file before use.

- **Badge** → `@components/badge.html`: `badge-numeric`, `badge-dot`
- **Button** → `@components/button.html`: `button-primary`, `button-icon`, `button-with-icon`
- **Card** → `@components/card.html`: `card-elevated`, `card-action`, `card-interactive`, `card-interactive-2`
- **Input Field** → `@components/input-field.html`: `input-field-text`, `input-field-icon`
- **Table** → `@components/table.html`: `table-standard`, `table-interactive`, `table-selectable`
