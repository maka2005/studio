import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor';
          if (id.includes('node_modules/@supabase/')) return 'supabase-vendor';
          if (/node_modules\/date-fns(-tz)?\//.test(id)) return 'date-vendor';
          return 'vendor';
        },
      },
    },
  },
});
