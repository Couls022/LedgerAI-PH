const fs = require('fs');
const os = require('os');
const path = require('path');
const asar = require('@electron/asar');

exports.default = async function afterPackClient(context) {
  const appAsar = path.join(context.appOutDir, 'resources', 'app.asar');
  const sourceFile = path.join(
    context.packager.projectDir,
    'node_modules',
    'google-auth-library',
    'build',
    'src',
    'auth',
    'stscredentials.js'
  );

  if (!fs.existsSync(appAsar) || !fs.existsSync(sourceFile)) {
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgerai-client-asar-'));
  try {
    asar.extractAll(appAsar, tmpDir);

    const targetFile = path.join(
      tmpDir,
      'node_modules',
      'google-auth-library',
      'build',
      'src',
      'auth',
      'stscredentials.js'
    );
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.copyFileSync(sourceFile, targetFile);

    fs.rmSync(appAsar, { force: true });
    await asar.createPackage(tmpDir, appAsar);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
};
