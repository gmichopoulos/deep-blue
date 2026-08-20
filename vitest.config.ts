import { defineConfig } from 'vitest/config';

/**
 * Test config for the simulation core.
 *
 * `environment: 'node'` on purpose: everything under `src/sim` and `src/world`
 * is pure and DOM-free, and the UI modules (which do need a DOM) are out of
 * scope for this suite. If a test ever needs `document`, that is a signal the
 * module under test has grown a dependency it should not have.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
