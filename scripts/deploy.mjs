import * as ftp from 'basic-ftp';
import path from 'path';
import fs from 'fs';

const FTP_CONFIG = {
  host: '146.59.68.226',
  user: 'UAreaper@bitschool.com.ua',
  password: '15935750Aa',
  secure: false
};

async function runDeployAttempt(attempt = 1) {
  const client = new ftp.Client();
  client.ftp.verbose = true;
  client.ftp.timeout = 45000;

  try {
    console.log(`\n=== Connecting to FTP (Attempt ${attempt}/3)... ===`);
    await client.access(FTP_CONFIG);
    console.log('Connected!');

    await client.cd('public_html');
    console.log('Entered public_html');

    // 1. Upload root bootstrap files
    console.log('\n--- Uploading root bootstrap files ---');
    await client.uploadFrom('app.js', 'app.js');
    await client.uploadFrom('package.json', 'package.json');
    if (fs.existsSync('package-lock.json')) {
      await client.uploadFrom('package-lock.json', 'package-lock.json');
    }

    // 2. Upload directories
    console.log('\n--- Uploading client directory ---');
    await client.uploadFromDir('client', 'client');

    console.log('\n--- Uploading server directory ---');
    await client.uploadFromDir('server', 'server');

    console.log('\n--- Uploading shared directory ---');
    await client.uploadFromDir('shared', 'shared');

    console.log('\n--- Uploading node_modules/ws directory ---');
    await client.uploadFromDir('node_modules/ws', 'node_modules/ws');

    console.log('\n✔ DEPLOYMENT COMPLETED SUCCESSFULLY!');
    return true;
  } catch (err) {
    console.error(`Deployment error on attempt ${attempt}:`, err.message || err);
    if (attempt < 3) {
      console.log('Waiting 3s before retrying...');
      await new Promise(r => setTimeout(r, 3000));
      return runDeployAttempt(attempt + 1);
    }
    throw err;
  } finally {
    client.close();
  }
}

async function main() {
  try {
    await runDeployAttempt(1);
  } catch (err) {
    console.error('All deployment attempts failed:', err);
    process.exit(1);
  }
}

main();
