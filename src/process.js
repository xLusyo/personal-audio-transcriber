const { spawn } = require('node:child_process');

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-8000); });
    child.on('error', error => reject(new Error(`Could not run ${command}: ${error.message}`)));
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}: ${stderr}`));
    });
  });
}
module.exports = { runCommand };
