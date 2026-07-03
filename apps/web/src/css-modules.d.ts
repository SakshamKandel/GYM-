// Ambient declaration so bare `tsc --noEmit` accepts global CSS side-effect
// imports (e.g. `import './globals.css'`). Next.js handles these at build time;
// this keeps the standalone typecheck script green.
declare module '*.css';
