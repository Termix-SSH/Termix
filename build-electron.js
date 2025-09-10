import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check if we're in a path with spaces
const currentPath = process.cwd();
if (currentPath.includes(' ')) {
    console.log('⚠️  Warning: Project path contains spaces which may cause issues with native modules.');
    console.log('Current path:', currentPath);
    console.log('Consider moving the project to a path without spaces for better compatibility.');
    console.log('');
}

// Set environment variables to help with native module compilation
process.env.npm_config_cache = path.join(process.cwd(), 'node_modules', '.cache');
process.env.npm_config_tmp = path.join(process.cwd(), 'node_modules', '.tmp');

console.log('Building Electron application...');

// Skip better-sqlite3 rebuild due to path issues
console.log('Skipping better-sqlite3 rebuild due to path space issues...');
console.log('Note: Using existing better-sqlite3 installation.');

// Run the electron-builder
try {
    execSync('npx electron-builder', { stdio: 'inherit' });
    console.log('✅ Electron build completed successfully!');
} catch (error) {
    console.error('❌ Electron build failed:', error.message);
    process.exit(1);
}
