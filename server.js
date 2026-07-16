const express = require('express');
const ytSearch = require('yt-search');
const cors = require('cors');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const http = require('http');

const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

const isWin = process.platform === 'win32';
const YTDLP_PATH = path.join(__dirname, isWin ? 'yt-dlp.exe' : 'yt-dlp');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

const YTDLP_ARGS = [
    '--no-playlist',
    '--no-warnings',
    '--no-check-certificates',
    '--js-runtimes', 'node',
    '--extractor-args', 'youtube:player_client=web_embedded'
];

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const infoCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCachedInfo(url) {
    const cached = infoCache.get(url);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;
    infoCache.delete(url);
    return null;
}

function setCachedInfo(url, data) {
    if (infoCache.size > 100) {
        infoCache.delete(infoCache.keys().next().value);
    }
    infoCache.set(url, { data, timestamp: Date.now() });
}

const searchCache = new Map();
const SEARCH_CACHE_TTL = 10 * 60 * 1000;

function getCachedSearch(query) {
    const cached = searchCache.get(query);
    if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL) return cached.data;
    searchCache.delete(query);
    return null;
}

function setCachedSearch(query, data) {
    if (searchCache.size > 50) {
        searchCache.delete(searchCache.keys().next().value);
    }
    searchCache.set(query, { data, timestamp: Date.now() });
}

function extractVideoId(url) {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([^&?/]+)/);
    return match ? match[1] : null;
}

function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes) {
    if (!bytes) return null;
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
    return mb.toFixed(1) + ' MB';
}

function runYtDlp(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn(YTDLP_PATH, [...YTDLP_ARGS, ...args]);
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', d => { stdout += d.toString(); });
        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.on('close', code => {
            if (stderr) console.log('yt-dlp:', stderr.substring(0, 500));
            if (code === 0) {
                resolve(stdout.trim());
            } else {
                reject(new Error(stderr || 'yt-dlp failed with code ' + code));
            }
        });
        proc.on('error', reject);
    });
}

async function getVideoInfo(videoId) {
    const json = await runYtDlp(['-j', `https://www.youtube.com/watch?v=${videoId}`]);
    const info = JSON.parse(json);

    const allFormats = info.formats || [];
    const videoFormats = [];
    const resolutionsSeen = new Set();

    const videoOnly = allFormats
        .filter(f => f.vcodec !== 'none' && f.acodec === 'none' && f.height)
        .sort((a, b) => (b.height || 0) - (a.height || 0));

    for (const f of videoOnly) {
        const key = f.height + 'p_' + (f.fps || 30);
        if (!resolutionsSeen.has(key)) {
            resolutionsSeen.add(key);
            videoFormats.push({
                format_id: f.format_id,
                quality: f.height + 'p',
                container: (f.ext || 'mp4'),
                size: formatFileSize(f.filesize || f.filesize_approx),
                fps: f.fps || 30,
                height: f.height
            });
        }
    }

    const audioFormats = [];
    const audioBitratesSeen = new Set();

    const audioOnly = allFormats
        .filter(f => f.acodec !== 'none' && f.vcodec === 'none')
        .sort((a, b) => (b.abr || 0) - (a.abr || 0));

    for (const f of audioOnly) {
        const key = (f.abr || 128) + 'kbps';
        if (!audioBitratesSeen.has(key)) {
            audioBitratesSeen.add(key);
            audioFormats.push({
                format_id: f.format_id,
                quality: (f.abr || 128) + ' kbps',
                container: (f.ext || 'mp3'),
                size: formatFileSize(f.filesize || f.filesize_approx),
                bitrate: f.abr || 128
            });
        }
    }

    return {
        title: info.title || 'Sem titulo',
        thumbnail: info.thumbnail || `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
        duration: formatDuration(info.duration || 0),
        author: info.uploader || info.channel || 'Desconhecido',
        views: (info.view_count || 0).toLocaleString('pt-BR'),
        videoFormats,
        audioFormats
    };
}

app.post('/api/search', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query || query.trim().length === 0) {
            return res.status(400).json({ error: 'Digite um termo para pesquisa' });
        }

        const normalizedQuery = query.trim().toLowerCase();
        const cached = getCachedSearch(normalizedQuery);
        if (cached) return res.json({ videos: cached });

        const searchResults = await ytSearch(query);
        const videos = searchResults.videos.slice(0, 12).map(v => ({
            videoId: v.videoId,
            title: v.title,
            thumbnail: v.thumbnail,
            duration: v.timestamp,
            author: v.author.name,
            views: v.views ? parseInt(v.views).toLocaleString('pt-BR') : '0',
            url: v.url,
            description: v.description ? v.description.substring(0, 120) + '...' : ''
        }));

        setCachedSearch(normalizedQuery, videos);
        res.json({ videos });
    } catch (error) {
        console.error('Erro na pesquisa:', error.message);
        res.status(500).json({ error: 'Erro ao pesquisar. Tente novamente.' });
    }
});

app.post('/api/info', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL e obrigatoria' });

        const cached = getCachedInfo(url);
        if (cached) return res.json(cached);

        const videoId = extractVideoId(url);
        if (!videoId) return res.status(400).json({ error: 'URL do YouTube invalida' });

        console.log('Buscando info para:', videoId);
        const data = await getVideoInfo(videoId);
        console.log('Info obtida:', data.title);

        setCachedInfo(url, data);
        res.json(data);
    } catch (error) {
        console.error('Erro ao obter informacoes:', error.message);
        res.status(500).json({ error: 'Erro ao processar o video. Verifique se o video existe e e publico.' });
    }
});

app.get('/api/download', async (req, res) => {
    const { url, format_id, type } = req.query;
    if (!url) return res.status(400).json({ error: 'URL e obrigatoria' });

    console.log('Download solicitado:', url, 'format:', format_id, 'tipo:', type);

    let tempFile = null;

    try {
        const videoId = extractVideoId(url);
        if (!videoId) return res.status(400).json({ error: 'URL do YouTube invalida' });

        const infoJson = await runYtDlp(['-j', `https://www.youtube.com/watch?v=${videoId}`]);
        const info = JSON.parse(infoJson);
        const title = (info.title || 'video').replace(/[^a-zA-Z0-9\s\-_]/g, '').substring(0, 80) || 'video';

        const uniqueId = crypto.randomBytes(8).toString('hex');

        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

        if (type === 'audio') {
            tempFile = path.join(DOWNLOADS_DIR, `${videoId}_${uniqueId}.m4a`);
            const args = ['-f', 'bestaudio', '-o', tempFile, videoUrl];
            console.log('Audio download:', args.join(' '));
            await runYtDlp(args);
            res.setHeader('Content-Disposition', `attachment; filename="${title}.m4a"`);
            res.setHeader('Content-Type', 'audio/mpeg');
        } else {
            tempFile = path.join(DOWNLOADS_DIR, `${videoId}_${uniqueId}.mp4`);
            const args = ['-f', 'best', '-o', tempFile, videoUrl];
            console.log('Video download:', args.join(' '));
            await runYtDlp(args);
            res.setHeader('Content-Disposition', `attachment; filename="${title}.mp4"`);
            res.setHeader('Content-Type', 'video/mp4');
        }

        if (!fs.existsSync(tempFile)) {
            return res.status(500).json({ error: 'Arquivo nao foi criado.' });
        }

        const fileStream = fs.createReadStream(tempFile);
        fileStream.pipe(res);

        fileStream.on('end', () => {
            setTimeout(() => {
                try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (e) {}
            }, 5000);
        });

        fileStream.on('error', (err) => {
            console.error('Erro ao ler arquivo:', err.message);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Erro ao enviar arquivo.' });
            }
            try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (e) {}
        });

        req.on('close', () => {
            try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (e) {}
        });

    } catch (error) {
        console.error('Erro no download:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Erro ao processar download. Tente novamente.' });
        }
        if (tempFile) {
            try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch (e) {}
        }
    }
});

if (!fs.existsSync(YTDLP_PATH)) {
    console.error('yt-dlp nao encontrado em:', YTDLP_PATH);
    console.error('Execute setup.js primeiro: node setup.js');
    process.exit(1);
}

app.listen(PORT, () => {
    console.log(`Servidor ADPEX Video rodando em http://localhost:${PORT}`);
    console.log(`yt-dlp: ${YTDLP_PATH}`);
});
