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
    build: {
        rollupOptions: {
            input: {
                main: 'index.html',
                deploy: 'deploy-factory.html'
            }
        }
    }
});
