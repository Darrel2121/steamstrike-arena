/**
 * Steampunk Tactical Arena - Application Bootstrap
 * Primary entry point for CloudLinux / DirectAdmin / Passenger Node.js environments.
 */
import startServer from './server/index.js';

const PORT = process.env.PORT || 3000;
startServer(PORT);
