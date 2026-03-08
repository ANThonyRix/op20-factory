import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
    plugins: [
        nodePolyfills({
            include: ['buffer', 'crypto', 'stream', 'util'],
            globals: {
                Buffer: true,
            },
        }),
    ],
    define: {
        'process.env': {}
    },
    server: {
        proxy: {
            '/api': {
                target: 'https://testnet.opnet.org',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, ''),
                secure: false,
            }
        }
    },
    build: {
        rollupOptions: {
            input: {
                main: 'index.html',
                deploy: 'deploy-factory.html'
            }
        }
    }
});
