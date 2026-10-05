import * as ftp from 'basic-ftp';
import path from 'path';
import fs from 'fs';

const FTP_CONFIG = {
  host: '146.59.68.226',
  user: 'UAreaper@bitschool.com.ua',
  password: '15935750Aa',
  secure: false
};

async function main() {
  const client = new ftp.Client();
  client.ftp.verbose = true;

  try {
    console.log('Connecting to FTP...');
    await client.access(FTP_CONFIG);
    console.log('Connected!');

    await client.cd('public_html');
    console.log('Entered public_html');

    const initialList = await client.list();
    console.log('Current files in public_html:');
    for (const item of initialList) {
      console.log(` - ${item.name} (${item.isDirectory ? 'DIR' : item.size + ' bytes'})`);
    }

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

    console.log('\n--- Verifying final public_html state ---');
    const finalList = await client.list();
    for (const item of finalList) {
      console.log(` - ${item.name} (${item.isDirectory ? 'DIR' : item.size + ' bytes'})`);
    }

    console.log('\n✔ DEPLOYMENT COMPLETED SUCCESSFULLY!');
  } catch (err) {
    console.error('Deployment error:', err);
    process.exit(1);
  } finally {
    client.close();
  }
}

main();
