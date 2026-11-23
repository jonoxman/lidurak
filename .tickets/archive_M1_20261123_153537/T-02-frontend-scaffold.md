# T-02: Frontend Project Scaffolding (Vite + Preact + TypeScript)

## Objective
Create the `frontend/` project with Vite, Preact, TypeScript 5, and Vitest. Configure the dev-server proxy for `/api` and `/ws` to `http://localhost:8080`. Confirm the build and test pipelines work.

## Requirements

### Directory Structure
```
frontend/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts  (or merged into vite.config.ts)
└── src/
    ├── main.tsx
    ├── app.tsx
    ├── app.css
    └── __tests__/
        └── app.test.tsx
```

### `package.json`
- Dependencies: `preact`
- Dev dependencies: `vite`, `@preact/preset-vite`, `typescript`, `vitest`, `@testing-library/preact`, `jsdom`
- Scripts:
  - `"dev": "vite --host 0.0.0.0 --port 5173"`
  - `"build": "vite build"`
  - `"test": "vitest"`

### `vite.config.ts`
```typescript
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': {
        target: 'http://localhost:8080',
        ws: true,
      },
    },
  },
});
```

### `tsconfig.json`
- `"compilerOptions"`: target `"ES2020"`, module `"ESNext"`, jsx `"react-jsx"`, jsxImportSource `"preact"`, strict `true`, moduleResolution `"bundler"`.

### `app.tsx`
A minimal Preact component rendering `<div class="app"><h1>Lidurak</h1></div>`.

### `app.css`
```css
body {
  margin: 0;
  background-color: #161512;
  color: #bababa;
  font-family: 'Segoe UI', system-ui, sans-serif;
}
```

### `app.test.tsx`
A Vitest test that renders the `App` component and asserts the heading text is `"Lidurak"`.

## Acceptance Criteria
- [ ] `cd frontend && npm install` succeeds
- [ ] `cd frontend && npm run build` produces output in `frontend/dist/`
- [ ] `cd frontend && npm test -- --run` runs `app.test.tsx` and all tests pass

## Verification Command
```bash
cd frontend && npm install && npm test -- --run
```

