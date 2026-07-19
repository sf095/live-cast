/**
 * Network Utilities
 * 
 * Helper functions for resolving local network address info.
 */

const os = require('os');

/**
 * Returns the first active non-loopback IPv4 address of the host machine.
 * Useful for telling external devices on the LAN how to reach this server.
 * 
 * @returns {string} IP address
 */
function getLocalIPv4() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // family is 'IPv4' or 4 depending on Node version
      if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

module.exports = { getLocalIPv4 };
