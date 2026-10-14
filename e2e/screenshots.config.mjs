import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';

export default defineConfig({
  ...base,
  testDir: './screenshots',
  workers: 1,
  reporter: 'list',
});
