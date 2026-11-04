import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // 原系统接口是 HTTP 且无 CORS 头，浏览器端必须经本地代理转发
    proxy: {
      '/kddz': {
        target: 'http://sdcz.swfu.edu.cn',
        changeOrigin: true,
      },
    },
  },
});
