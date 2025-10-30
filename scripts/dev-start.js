#!/usr/bin/env node

/**
 * Development startup script that finds available ports and starts both
 * server and web applications with proper configuration
 */

const { spawn } = require('child_process');
const { findAvailablePort } = require('./find-available-port');
const path = require('path');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Track child processes for cleanup
const processes = [];

// Cleanup function
function cleanup() {
  log('\n🛑 Shutting down services...', 'yellow');
  processes.forEach(proc => {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
    }
  });
  setTimeout(() => {
    processes.forEach(proc => {
      if (proc && !proc.killed) {
        proc.kill('SIGKILL');
      }
    });
    process.exit(0);
  }, 2000);
}

// Handle process termination
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

async function startDev() {
  try {
    log('🚀 Starting development environment...', 'bright');
    log('🔍 Finding available ports...', 'cyan');
    
    // Find available port for server (starting from 3000)
    const serverPort = await findAvailablePort(3000);
    log(`✅ Server port: ${serverPort}`, 'green');
    
    // Find available port for web (starting from server port + 1, or 3001 if server is not 3000)
    const webBasePort = serverPort === 3000 ? 3001 : serverPort + 1;
    const webPort = await findAvailablePort(webBasePort);
    log(`✅ Web port: ${webPort}`, 'green');
    
    // Construct URLs
    const serverUrl = `http://localhost:${serverPort}`;
    const webUrl = `http://localhost:${webPort}`;
    
    log('\n📋 Configuration:', 'bright');
    log(`   Server: ${serverUrl}`, 'cyan');
    log(`   Web: ${webUrl}`, 'cyan');
    log(`   CORS Origin: ${webUrl}`, 'cyan');
    log(`   NEXT_PUBLIC_SERVER_URL: ${serverUrl}`, 'cyan');
    log('');
    
    // Set up environment variables
    const serverEnv = {
      ...process.env,
      PORT: serverPort.toString(),
      NODE_ENV: 'development',
      CORS_ORIGIN: webUrl,
    };
    
    const webEnv = {
      ...process.env,
      PORT: webPort.toString(),
      SERVER_PORT: serverPort.toString(),
      NEXT_PUBLIC_SERVER_URL: serverUrl,
      NODE_ENV: 'development',
    };
    
    // Start server
    log('📦 Starting server...', 'yellow');
    const serverPath = path.join(__dirname, '..', 'apps', 'server');
    // Use npx to run next dev directly with explicit port
    const serverProcess = spawn('npx', ['next', 'dev', '-p', serverPort.toString()], {
      cwd: serverPath,
      env: serverEnv,
      stdio: 'inherit',
      shell: true,
    });
    
    processes.push(serverProcess);
    
    serverProcess.on('error', (err) => {
      log(`❌ Server error: ${err.message}`, 'red');
      cleanup();
    });
    
    // Start web (wait a bit for server to initialize)
    setTimeout(() => {
      log('🌐 Starting web...', 'yellow');
      const webPath = path.join(__dirname, '..', 'apps', 'web');
      // Use npx to run next dev directly with explicit port
      const webProcess = spawn('npx', ['next', 'dev', '-p', webPort.toString()], {
        cwd: webPath,
        env: webEnv,
        stdio: 'inherit',
        shell: true,
      });
      
      processes.push(webProcess);
      
      webProcess.on('error', (err) => {
        log(`❌ Web error: ${err.message}`, 'red');
        cleanup();
      });
      
      log('\n✨ Development environment ready!', 'green');
      log(`   Frontend: ${webUrl}`, 'cyan');
      log(`   Backend API: ${serverUrl}`, 'cyan');
      log('\nPress Ctrl+C to stop all services\n', 'yellow');
    }, 2000);
    
  } catch (error) {
    log(`❌ Error: ${error.message}`, 'red');
    process.exit(1);
  }
}

startDev();

