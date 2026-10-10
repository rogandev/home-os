import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],build:{outDir:'dist-razors',rollupOptions:{input:'fixtures/razors/index.html'}}});
