import net from 'net';

/**
 * Find an available port starting from the preferred port
 * @param preferredPort The preferred port to use
 * @param maxAttempts Maximum number of ports to try
 * @returns Promise resolving to an available port number
 */
export async function findAvailablePort(
  preferredPort: number,
  maxAttempts: number = 10
): Promise<number> {
  return new Promise((resolve, reject) => {
    let currentPort = preferredPort;
    let attempts = 0;

    const tryPort = (port: number) => {
      const server = net.createServer();

      server.listen(port, '0.0.0.0', () => {
        server.once('close', () => {
          resolve(port);
        });
        server.close();
      });

      server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          attempts++;
          if (attempts >= maxAttempts) {
            reject(new Error(`Could not find an available port after ${maxAttempts} attempts`));
          } else {
            currentPort++;
            tryPort(currentPort);
          }
        } else {
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
export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

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
