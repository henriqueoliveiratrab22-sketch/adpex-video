const express = require('express');
const { spawn } = require('child_process');
const ytSearch = require('yt-search');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const YTDLP_PATH = path.join(__dirname, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const infoCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCachedInfo(url) {
    const cached = infoCache.get(url);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }
    infoCache.delete(url);
    return null;
}

function setCachedInfo(url, data) {
    if (infoCache.size > 100) {
        const oldestKey = infoCache.keys().next().value;
        infoCache.delete(oldestKey);
    }
    infoCache.set(url, { data, timestamp: Date.now() });
}

const searchCache = new Map();
const SEARCH_CACHE_TTL = 10 * 60 * 1000;

function getCachedSearch(query) {
    const cached = searchCache.get(query);
    if (cached && Date.now() - cached.timestamp < SEARCH_CACHE_TTL) {
        return cached.data;
    }
    searchCache.delete(query);
    return null;
}

function setCachedSearch(query, data) {
    if (searchCache.size > 50) {
        const oldestKey = searchCache.keys().next().value;
        searchCache.delete(oldestKey);
    }
    searchCache.set(query, { data, timestamp: Date.now() });
}

function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes) {
    if (!bytes) return null;
    const mb = bytes / (1024 * 1024);
    if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB';
    return mb.toFixed(1) + ' MB';
}

function getYtdlpInfo(url) {
    return new Promise((resolve, reject) => {
        const proc = spawn(YTDLP_PATH, ['-j', '--no-playlist', url], {
            timeout: 30000,
            windowsHide: true
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data) => { stdout += data.toString(); });
        proc.stderr.on('data', (data) => { stderr += data.toString(); });

        proc.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(stderr || 'yt-dlp retornou código ' + code));
                return;
            }
            try {
                resolve(JSON.parse(stdout));
            } catch (e) {
                reject(new Error('Falha ao processar dados do vídeo'));
            }
        });

        proc.on('error', (err) => {
            reject(new Error('Falha ao executar yt-dlp: ' + err.message));
        });
    });
}

app.post('/api/search', async (req, res) => {
    try {
        const { query } = req.body;
        if (!query || query.trim().length === 0) {
            return res.status(400).json({ error: 'Digite um termo para pesquisa' });
        }

        const normalizedQuery = query.trim().toLowerCase();
        const cached = getCachedSearch(normalizedQuery);
        if (cached) {
            return res.json({ videos: cached });
        }

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
        console.error('Erro na pesquisa:', error);
        res.status(500).json({ error: 'Erro ao pesquisar. Tente novamente.' });
    }
});

app.post('/api/info', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'URL é obrigatória' });
        }

        const cached = getCachedInfo(url);
        if (cached) {
            return res.json(cached);
        }

        console.log('Buscando info para:', url);
        const info = await getYtdlpInfo(url);
        console.log('Info obtida:', info.title);

        const videoFormats = [];
        const resolutionsSeen = new Set();

        const videoOnlyFormats = (info.formats || [])
            .filter(f => f.vcodec !== 'none' && f.acodec === 'none' && f.height)
            .sort((a, b) => (b.height || 0) - (a.height || 0));

        for (const f of videoOnlyFormats) {
            const key = f.height + 'p_' + (f.fps || 30);
            if (!resolutionsSeen.has(key)) {
                resolutionsSeen.add(key);
                videoFormats.push({
                    format_id: f.format_id,
                    quality: f.height + 'p',
                    container: f.ext || 'mp4',
                    size: formatFileSize(f.filesize_approx),
                    fps: f.fps || 30,
                    height: f.height
                });
            }
        }

        const combinedFormat = (info.formats || []).find(f => f.vcodec !== 'none' && f.acodec !== 'none' && f.height);
        if (combinedFormat && !resolutionsSeen.has(combinedFormat.height + 'p_' + (combinedFormat.fps || 30))) {
            videoFormats.unshift({
                format_id: combinedFormat.format_id,
                quality: combinedFormat.height + 'p',
                container: combinedFormat.ext || 'mp4',
                size: formatFileSize(combinedFormat.filesize_approx),
                fps: combinedFormat.fps || 30,
                height: combinedFormat.height
            });
        }

        videoFormats.sort((a, b) => (b.height || 0) - (a.height || 0));

        const audioFormats = [];
        const audioBitratesSeen = new Set();

        const audioOnlyFormats = (info.formats || [])
            .filter(f => f.acodec !== 'none' && f.vcodec === 'none' && f.audio_bitrate)
            .sort((a, b) => (b.audio_bitrate || 0) - (a.audio_bitrate || 0));

        for (const f of audioOnlyFormats) {
            const key = f.audio_bitrate + 'kbps';
            if (!audioBitratesSeen.has(key)) {
                audioBitratesSeen.add(key);
                audioFormats.push({
                    format_id: f.format_id,
                    quality: f.audio_bitrate + ' kbps',
                    container: f.ext || 'mp4',
                    size: formatFileSize(f.filesize_approx),
                    bitrate: f.audio_bitrate
                });
            }
        }

        const responseData = {
            title: info.title,
            thumbnail: info.thumbnail,
            duration: formatDuration(info.duration || 0),
            author: info.uploader || info.channel || 'Desconhecido',
            views: (info.view_count || 0).toLocaleString('pt-BR'),
            videoFormats,
            audioFormats
        };

        setCachedInfo(url, responseData);
        res.json(responseData);
    } catch (error) {
        console.error('Erro ao obter informações:', error.message);
        res.status(500).json({ error: 'Erro ao processar o vídeo. Verifique se o vídeo existe e é público.' });
    }
});

app.get('/api/download', async (req, res) => {
    const { url, format_id, type } = req.query;
    if (!url) {
        return res.status(400).json({ error: 'URL é obrigatória' });
    }

    console.log('Download solicitado:', url, 'format_id:', format_id, 'tipo:', type);

    try {
        const info = await getYtdlpInfo(url);
        const title = (info.title || 'video').replace(/[^a-zA-Z0-9\s\-_]/g, '').substring(0, 80) || 'video';
        const container = type === 'audio' ? 'mp3' : 'mp4';
        const mime = type === 'audio' ? 'audio/mpeg' : 'video/mp4';

        let args = ['--no-playlist', '-o', '-', '--no-warnings'];

        if (type === 'audio') {
            if (format_id) {
                args.push('-f', format_id);
            } else {
                args.push('-f', 'bestaudio');
            }
            args.push('-x', '--audio-format', 'mp3');
        } else {
            if (format_id) {
                args.push('-f', format_id + '+bestaudio/best');
            } else {
                args.push('-f', 'bestvideo+bestaudio/best');
            }
            args.push('--merge-output-format', 'mp4');
        }

        args.push(url);

        console.log('yt-dlp args:', args.join(' '));

        res.setHeader('Content-Disposition', `attachment; filename="${title}.${container}"`);
        res.setHeader('Content-Type', mime);

        const proc = spawn(YTDLP_PATH, args, {
            timeout: 300000,
            windowsHide: true
        });

        let errorOutput = '';

        proc.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        proc.on('error', (err) => {
            console.error('Erro ao iniciar yt-dlp:', err.message);
            if (!res.headersSent) {
                res.status(500).json({ error: 'Erro ao iniciar download.' });
            } else {
                res.end();
            }
        });

        proc.on('close', (code) => {
            if (code !== 0) {
                console.error('yt-dlp erro:', errorOutput);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Erro ao baixar o vídeo.' });
                }
            }
        });

        proc.stdout.pipe(res);

    } catch (error) {
        console.error('Erro no download:', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Erro ao processar download. Tente novamente.' });
        }
    }
});

app.listen(PORT, () => {
    console.log(`Servidor ADPEX Video rodando em http://localhost:${PORT}`);
});
