# Auth UI Integration Review

_Last reviewed: 2025-01-13_

## 1. Snapshot of Imported Assets
- **Component library:** 40+ primitives under `src/components/ui` (buttons, inputs, dialog, select, table, status chip, etc.) generated from the Figma design system. Most primitives wrap Radix UI or other headless utilities and depend on Tailwind token classes (`bg-background`, `text-muted-foreground`, etc.).
- **Auth flows:** 12 screen-level components now under `src/components/auth` covering landing, login, magic link, MFA, recovery, profile, admin, and audit scenarios. Each screen composes the new UI primitives and Lucide icons.
- **Support modules:**
  - `DesignSystemGuide`, `Avatar*`, and `UserContext` showcase the Figma components.
  - Styles: `src/index.css` (Tailwind entry) and `src/styles/globals.css` (design tokens & resets) shipped by Figma.
  - `tmp/` holds an isolated Vite project scaffold (package.json, vite.config.ts) that declares required dependencies and alias mapping.

## 2. Immediate Compatibility Gaps
1. **Module imports with version suffixes.** UI primitives import packages like `"@radix-ui/react-dialog@1.1.6"`. Our Vite config has no aliases for these names, so bundling currently fails. Options: (a) bulk replace imports with versionless specifiers or (b) add the alias table from `tmp/vite.config.ts`.
2. **TypeScript artifacts in a JS-only app.** New files are `.tsx` with interface/type annotations and import `type { AuthScreen }`. Project lacks `tsconfig.json` and TS dependencies, so Vite will error when encountering these files. We can either adopt TypeScript (with `allowJs`) or strip types and rename to `.jsx`.
3. **Missing dependencies.** Figma package.json introduces ~25 packages (Radix UI modules, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `input-otp`, `react-hook-form`, `react-day-picker`, `embla-carousel-react`, `vaul`, `react-resizable-panels`, `sonner`, `next-themes`, `recharts`, etc.). None are installed yet, so any component rendering will break.
4. **Tailwind token setup.** `globals.css` expects Tailwind configuration with CSS variable-based colors (`bg-background`, `text-muted-foreground`), dark mode via `class`, radius tokens, and spacing variables. Our `tailwind.config.js` currently uses the default theme and only scans `*.{js,jsx}`.
5. **CSS variable completeness.** The generated `globals.css` references variables like `--spacing` and `--text-base` that are not defined. We need to set defaults (e.g., `--spacing: 0.25rem;`, `--text-base: 1rem`, etc.) to avoid computed `NaN` styles.
6. **Duplicate JSX/TSX files.** Some screens (e.g., `AuthLanding`) exist in both `.jsx` and `.tsx` forms. We should pick one convention to avoid divergent edits.
7. **Router integration still pending.** Existing app routes (`App.jsx`, React Router) do not yet reference the new screens. Additional wiring is required once the design system compiles.

## 3. Recommended Integration Plan
### 3.1 Tooling & Config
- **TypeScript adoption:** add `tsconfig.json` with `"allowJs": true`, `"jsx": "react-jsx"`, and include both `src/**/*.ts(x)` and `src/**/*.js(x)`.
- **Dependency install:** augment root `package.json` with the libraries below (align versions with Figma scaffold; adjust to latest if testing passes):
  - Core UI: `@radix-ui/react-*` (accordion, alert-dialog, aspect-ratio, avatar, checkbox, collapsible, context-menu, dialog, dropdown-menu, hover-card, label, menubar, navigation-menu, popover, progress, radio-group, scroll-area, select, separator, slider, slot, switch, tabs, toggle, toggle-group, tooltip)
  - Utilities: `class-variance-authority`, `clsx`, `tailwind-merge`
  - Icons & media: `lucide-react`, `input-otp`, `embla-carousel-react`, `react-resizable-panels`, `vaul`
  - Forms & feedback: `react-hook-form`, `sonner`, `next-themes`
  - Scheduling/analytics used in screens: `react-day-picker`, `recharts`, `cmdk` (for command palette in Admin screen)
- **Vite config:**
  - Convert `vite.config.js` to TypeScript (or enhance JS) and extend `resolve.extensions` to include `.ts`/`.tsx`.
  - Implement alias map replacing version-suffixed identifiers with canonical package names (copy from `tmp/vite.config.ts`). If we bulk edit imports to drop suffixes, the alias table can be simplified to `{ '@': path.resolve(__dirname, 'src') }`.
- **Tailwind config:**
  - Enable dark mode via `darkMode: ['class']`.
  - Expand `content` globs to `./src/**/*.{js,jsx,ts,tsx}`.
  - Extend theme with color tokens referencing CSS variables (shadcn pattern):
    ```js
    colors: {
      border: 'hsl(var(--border))',
      background: 'var(--background)',
      foreground: 'var(--foreground)',
      primary: { DEFAULT: 'var(--primary)', foreground: 'var(--primary-foreground)' },
      // ...secondary, muted, accent, destructive, success, etc.
    },
    borderRadius: {
      lg: 'var(--radius)',
      md: 'calc(var(--radius) - 4px)',
      sm: 'calc(var(--radius) - 8px)',
    },
    ```
  - Import `tailwindcss-animate` if we keep animated utilities (optional but recommended).

### 3.2 CSS & Theme Tokens
- Import both `index.css` and `styles/globals.css` in `src/main.jsx` (globals first, then Tailwind).
- Augment `globals.css` with missing values:
  ```css
  :root {
    --spacing: 0.25rem;
    --text-base: 1rem;
    --text-lg: 1.125rem;
    --text-xl: 1.25rem;
    --text-2xl: 1.5rem;
  }
  ```
- Ensure typography rules do not override Tailwind utility classes (confirm selectors and adjust if needed).

### 3.3 Codebase Harmonization
- **Choose file convention:** prefer `.tsx` and delete duplicate `.jsx` copies once TS support lands. Alternatively, strip types and stick to `.jsx`. TS provides better safety and matches Figma output.
- **Centralize exports:** index the new auth screens (e.g., `src/components/auth/index.ts`) for cleaner imports in routers.
- **Routing strategy:**
  - Option A: create dedicated auth router segment (`/auth/*`) using React Router and map each screen to a route.
  - Option B: integrate as modal/stepper within existing layout. Either way, ensure navigation callbacks hook into router rather than local state.
- **State wiring:** replace sample `UserContext` data with actual user profile data once Firebase auth lands; keep context as placeholder for now.
- **Theming:** wrap app with a simple `ThemeProvider` from `next-themes` (only if we keep `Toaster` component). Otherwise, we can remove `next-themes` usage from `sonner.tsx`.

### 3.4 Validation
- After installing dependencies and adjusting configs, run:
  ```bash
  npm install  # to pull new deps
  npm run lint
  npm run build
  npm run dev
  ```
- Verify key screens render without runtime errors, particularly components using Radix portals (Dialog, Dropdown, Select).
- Add smoke tests or Storybook snapshots for auth screens to protect future changes (optional but recommended).

## 4. Open Questions
1. Do we plan to keep the generated auxiliary screens (Design System Guide, Avatar Showcase) in production, or reserve them for an internal Storybook?
2. Should we adopt the full dependency set now, or trim to only those used in MVP flows to reduce bundle size?
3. Will we enforce TypeScript project-wide? If so, schedule follow-up refactor for existing JS files or rely on `allowJs` long term.
4. How do we want to expose the admin and audit dashboards—separate routes or integrated into existing dashboard navigation?

## 5. Next Actions
1. Approve TypeScript & dependency strategy (strip types vs adopt TS).
2. Decide on alias approach (rewrite imports vs mirror Figma aliases).
3. Update tooling configs and install dependencies.
4. Validate Tailwind theme tokens and global styles.
5. Integrate auth screens into routing flow once UI compiles.

Once we settle the decisions above, we can begin editing `package.json`, `vite.config.js`, Tailwind config, and CSS with confidence.

## 6. Finalized Approach (2025-01-14)
- **TypeScript adoption:** Keep the generated `.tsx` components and introduce a project-level `tsconfig.json` with `"allowJs": true`, `"jsx": "react-jsx"`, and `"moduleResolution": "bundler"`. Existing `.jsx`/`.js` files remain untouched; new UI work happens in TypeScript for safety. Duplicate `.jsx` variants (e.g., `AuthLanding.jsx`) will be removed once the TypeScript build is in place.
- **Module resolution:** Preserve Figma’s version-suffixed imports by extending Vite’s alias map (copied from `tmp/vite.config.ts`). This minimizes churn in generated files while keeping the door open to normalize imports later.
- **Dependencies:** Add only the packages actually referenced under `src/components/ui` and `src/components/auth` to the root `package.json` (Radix family, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `input-otp`, `react-hook-form`, `react-day-picker`, `embla-carousel-react`, `vaul`, `react-resizable-panels`, `cmdk`, `sonner`, `next-themes`, `recharts`). Lock versions to the scaffold for consistency.
- **Styling:** Import `src/styles/globals.css` before `index.css` in `main.jsx`, extend Tailwind with CSS-variable driven theming, and backfill missing tokens (`--spacing`, `--text-*`) to match design output. Keep existing dashboard styles intact by layering new tokens rather than overwriting legacy classes.
- **Routing integration:** Stage the new auth screens under a dedicated `/auth` router branch once the UI library compiles, leaving existing dashboard routes untouched until Firebase auth plumbing is ready.
- **Validation cadence:** After each milestone (tooling, styling, routing) run `npm run build` and smoke the dashboard UI to ensure no regression. Document findings or deltas in this file’s changelog.
+ **Status (2025-01-14 @ 09:45):** tsconfig added, Vite aliases configured, Tailwind/global styles layered. `package.json` updated but `npm install` needs to run outside the restricted sandbox to fetch dependencies before the next check-in.
+ **Status (2025-01-14 @ 10:05):** Removed unused `react-day-picker` dependency and calendar wrapper to keep the stack React 19 compatible prior to installing new packages.
+ **Status (2025-01-14 @ 10:20):** Hardened `DashboardDebugPanel` variant rendering to guard against nested metric objects and prevent crashes while navigating the existing dashboard.
