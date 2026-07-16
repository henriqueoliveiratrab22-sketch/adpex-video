const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const isWin = process.platform === 'win32';
const binaryName = isWin ? 'yt-dlp.exe' : 'yt-dlp';
const binaryPath = path.join(__dirname, binaryName);

if (fs.existsSync(binaryPath)) {
    console.log('yt-dlp já existe, pulando download.');
    process.exit(0);
}

const url = isWin
    ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
    : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

console.log('Baixando yt-dlp de:', url);

function download(targetUrl, dest) {
    return new Promise((resolve, reject) => {
        const follow = (u) => {
            const mod = u.startsWith('https') ? https : http;
            mod.get(u, { headers: { 'User-Agent': 'node' } }, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return follow(res.headers.location);
                }
                if (res.statusCode !== 200) {
                    return reject(new Error('HTTP ' + res.statusCode));
                }
                const file = fs.createWriteStream(dest);
                res.pipe(file);
                file.on('finish', () => { file.close(); resolve(); });
                file.on('error', reject);
            }).on('error', reject);
        };
        follow(targetUrl);
    });
}

(async () => {
    try {
        await download(url, binaryPath);
        if (!isWin) {
            fs.chmodSync(binaryPath, 0o755);
        }
        console.log('yt-dlp baixado com sucesso!');
    } catch (err) {
        console.error('Falha ao baixar yt-dlp:', err.message);
        process.exit(1);
    }
})();
