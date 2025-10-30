#!/usr/bin/env node

/**
 * Finds an available port starting from a given base port
 * @param {number} basePort - The port to start checking from
 * @param {number} maxAttempts - Maximum number of ports to check (default: 100)
 * @returns {Promise<number>} An available port number
 */
async function findAvailablePort(basePort, maxAttempts = 100) {
  const net = require('net');
  
  return new Promise((resolve, reject) => {
    let attempts = 0;
    let currentPort = basePort;
    
    const checkPort = (port) => {
      return new Promise((portResolve, portReject) => {
        const server = net.createServer();
        
        server.listen(port, () => {
          server.once('close', () => {
            portResolve(port);
          });
          server.close();
        });
        
        server.on('error', (err) => {
          if (err.code === 'EADDRINUSE') {
            portReject(new Error('Port in use'));
          } else {
            portReject(err);
          }
        });
      });
    };
    
    const tryNextPort = async () => {
      if (attempts >= maxAttempts) {
        reject(new Error(`Could not find available port after ${maxAttempts} attempts starting from ${basePort}`));
        return;
      }
      
      try {
        const port = await checkPort(currentPort);
        resolve(port);
      } catch (err) {
        if (err.message === 'Port in use') {
          attempts++;
          currentPort++;
          tryNextPort();
        } else {
          reject(err);
        }
      }
    };
    
    tryNextPort();
  });
}

// If run directly, check port from command line argument or default to 3000
if (require.main === module) {
  const basePort = parseInt(process.argv[2] || '3000', 10);
  
  findAvailablePort(basePort)
    .then(port => {
      console.log(port);
      process.exit(0);
    })
    .catch(err => {
      console.error('Error finding available port:', err.message);
      process.exit(1);
    });
}

module.exports = { findAvailablePort };

