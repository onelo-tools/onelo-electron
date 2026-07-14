import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: true,
  outDir: 'dist',
  external: ['electron', '@supabase/supabase-js'],
  noExternal: ['@onelo/core'],
  clean: true,
})
