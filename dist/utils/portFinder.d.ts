/**
 * Find an available port starting from the preferred port
 * @param preferredPort The preferred port to use
 * @param maxAttempts Maximum number of ports to try
 * @returns Promise resolving to an available port number
 */
export declare function findAvailablePort(preferredPort: number, maxAttempts?: number): Promise<number>;
/**
 * Check if a port is available
 * @param port Port number to check
 * @returns Promise resolving to true if available, false otherwise
 */
export declare function isPortAvailable(port: number): Promise<boolean>;
//# sourceMappingURL=portFinder.d.ts.map