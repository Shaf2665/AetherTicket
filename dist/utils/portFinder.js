"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findAvailablePort = findAvailablePort;
exports.isPortAvailable = isPortAvailable;
const net_1 = __importDefault(require("net"));
/**
 * Find an available port starting from the preferred port
 * @param preferredPort The preferred port to use
 * @param maxAttempts Maximum number of ports to try
 * @returns Promise resolving to an available port number
 */
async function findAvailablePort(preferredPort, maxAttempts = 10) {
    return new Promise((resolve, reject) => {
        let currentPort = preferredPort;
        let attempts = 0;
        const tryPort = (port) => {
            const server = net_1.default.createServer();
            server.listen(port, '0.0.0.0', () => {
                server.once('close', () => {
                    resolve(port);
                });
                server.close();
            });
            server.on('error', (error) => {
                if (error.code === 'EADDRINUSE') {
                    attempts++;
                    if (attempts >= maxAttempts) {
                        reject(new Error(`Could not find an available port after ${maxAttempts} attempts`));
                    }
                    else {
                        currentPort++;
                        tryPort(currentPort);
                    }
                }
                else {
                    reject(error);
                }
            });
        };
        tryPort(currentPort);
    });
}
/**
 * Check if a port is available
 * @param port Port number to check
 * @returns Promise resolving to true if available, false otherwise
 */
async function isPortAvailable(port) {
    return new Promise((resolve) => {
        const server = net_1.default.createServer();
        server.listen(port, '0.0.0.0', () => {
            server.once('close', () => {
                resolve(true);
            });
            server.close();
        });
        server.on('error', () => {
            resolve(false);
        });
    });
}
//# sourceMappingURL=portFinder.js.map