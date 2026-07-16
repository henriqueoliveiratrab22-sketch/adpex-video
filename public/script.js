// ===== ADPEX Video - Script =====

const videoUrlInput = document.getElementById('videoUrl');
const fetchBtn = document.getElementById('fetchBtn');

const searchQuery = document.getElementById('searchQuery');
const searchBtn = document.getElementById('searchBtn');
const searchResults = document.getElementById('searchResults');

const videoInfo = document.getElementById('videoInfo');
const errorMessage = document.getElementById('errorMessage');
const errorText = document.getElementById('errorText');
const backBtn = document.getElementById('backBtn');

const thumbnail = document.getElementById('thumbnail');
const videoTitle = document.getElementById('videoTitle');
const duration = document.getElementById('duration');
const author = document.getElementById('author');
const views = document.getElementById('views');

const videoFormatsDiv = document.getElementById('videoFormats');
const audioFormatsDiv = document.getElementById('audioFormats');
const tabBtns = document.querySelectorAll('.tab-btn');

const modeBtns = document.querySelectorAll('.mode-btn');
const searchMode = document.getElementById('searchMode');
const linkMode = document.getElementById('linkMode');

let currentVideoUrl = '';
let currentVideoData = null;
let lastSearchQuery = '';

modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const mode = btn.dataset.mode;
        if (mode === 'search') {
            searchMode.classList.remove('hidden');
            linkMode.classList.add('hidden');
        } else {
            searchMode.classList.add('hidden');
            linkMode.classList.remove('hidden');
        }

        hideVideoInfo();
        hideError();
    });
});

searchBtn.addEventListener('click', performSearch);

searchQuery.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        performSearch();
    }
});

fetchBtn.addEventListener('click', fetchVideoInfo);

videoUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        fetchVideoInfo();
    }
});

backBtn.addEventListener('click', () => {
    hideVideoInfo();
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        const tab = btn.dataset.tab;
        if (tab === 'video') {
            videoFormatsDiv.classList.remove('hidden');
            audioFormatsDiv.classList.add('hidden');
        } else {
            videoFormatsDiv.classList.add('hidden');
            audioFormatsDiv.classList.remove('hidden');
        }
    });
});

async function performSearch() {
    const query = searchQuery.value.trim();
    if (!query) {
        showError('Digite um termo para pesquisar no YouTube.');
        return;
    }

    hideError();
    setSearchLoading(true);

    searchResults.classList.remove('hidden');
    searchResults.innerHTML = createSkeletonCards(6);

    try {
        const response = await fetch('/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro na pesquisa.');
        }

        lastSearchQuery = query;
        displaySearchResults(data.videos);
    } catch (error) {
        showError(error.message || 'Erro de conexão. Verifique se o servidor está rodando.');
        searchResults.classList.add('hidden');
    } finally {
        setSearchLoading(false);
    }
}

function createSkeletonCards(count) {
    let html = '';
    for (let i = 0; i < count; i++) {
        html += `
            <div class="skeleton-card">
                <div class="skeleton-thumb"></div>
                <div class="skeleton-info">
                    <div class="skeleton-line"></div>
                    <div class="skeleton-line"></div>
                </div>
            </div>
        `;
    }
    return html;
}

function displaySearchResults(videos) {
    if (!videos || videos.length === 0) {
        searchResults.innerHTML = `
            <div class="card" style="padding: 24px;">
                <p style="color: var(--text-muted);">
                    Nenhum resultado encontrado para "<strong>${escapeHtml(lastSearchQuery)}</strong>"
                </p>
            </div>
        `;
        return;
    }

    searchResults.innerHTML = videos.map(video => `
        <div class="search-result-card" onclick="selectSearchResult('${escapeHtml(video.url)}')">
            <div class="search-result-thumb">
                <img src="${escapeHtml(video.thumbnail)}" alt="${escapeHtml(video.title)}" loading="lazy">
                <span class="search-result-duration">${escapeHtml(video.duration)}</span>
            </div>
            <div class="search-result-info">
                <h4>${escapeHtml(video.title)}</h4>
                <div class="search-result-meta">
                    <span>${escapeHtml(video.author)}</span>
                    <span class="separator"></span>
                    <span>${video.views} visualizações</span>
                </div>
            </div>
        </div>
    `).join('');
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

async function selectSearchResult(url) {
    hideError();
    currentVideoUrl = url;

    showVideoInfoLoading();

    try {
        const response = await fetch('/api/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao carregar vídeo.');
        }

        currentVideoData = data;
        displayVideoInfo(data);

        setTimeout(() => {
            videoInfo.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
    } catch (error) {
        showError(error.message || 'Erro ao carregar informações do vídeo.');
    }
}

function showVideoInfoLoading() {
    videoInfo.classList.remove('hidden');
    videoInfo.style.display = 'block';
    thumbnail.src = '';
    videoTitle.textContent = 'Carregando...';
    duration.textContent = '--:--';
    author.textContent = '...';
    views.textContent = '... visualizações';
    videoFormatsDiv.innerHTML = '<div class="format-skeleton"></div><div class="format-skeleton"></div><div class="format-skeleton"></div>';
    audioFormatsDiv.innerHTML = '';
}

async function fetchVideoInfo() {
    const url = videoUrlInput.value.trim();
    if (!url) {
        showError('Por favor, cole a URL do vídeo do YouTube.');
        return;
    }

    if (!url.includes('youtube.com/watch') && !url.includes('youtu.be/') && !url.includes('youtube.com/shorts')) {
        showError('URL inválida. Use um link do YouTube (youtube.com/watch?v=... ou youtu.be/...).');
        return;
    }

    hideError();
    setLinkLoading(true);
    currentVideoUrl = url;
    showVideoInfoLoading();

    try {
        const response = await fetch('/api/info', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Erro ao processar o vídeo.');
        }

        currentVideoData = data;
        displayVideoInfo(data);
    } catch (error) {
        showError(error.message || 'Erro de conexão. Verifique se o servidor está rodando.');
        videoInfo.classList.add('hidden');
        videoInfo.style.display = 'none';
    } finally {
        setLinkLoading(false);
    }
}

function displayVideoInfo(data) {
    thumbnail.src = data.thumbnail;
    thumbnail.alt = data.title;
    videoTitle.textContent = data.title;
    duration.textContent = data.duration;
    author.textContent = data.author;
    views.textContent = `${data.views} visualizações`;

    videoInfo.classList.remove('hidden');
    videoInfo.style.display = 'block';

    renderFormats(data.videoFormats, videoFormatsDiv, 'video');
    renderFormats(data.audioFormats, audioFormatsDiv, 'audio');

    tabBtns[0].click();
}

function renderFormats(formats, container, type) {
    if (!formats || formats.length === 0) {
        container.innerHTML = `
            <div class="format-item" style="justify-content: center; color: var(--text-muted);">
                Nenhum formato disponível
            </div>
        `;
        return;
    }

    container.innerHTML = formats.map(format => `
        <div class="format-item">
            <div class="format-info">
                <span class="format-badge">${escapeHtml(format.quality)}</span>
                ${format.size ? `<span class="format-size">${escapeHtml(format.size)}</span>` : ''}
                ${format.fps ? `<span class="format-badge">${format.fps}fps</span>` : ''}
            </div>
            <button class="btn-download" onclick="downloadVideo('${escapeHtml(format.format_id)}', '${type}', '${escapeHtml(format.quality)}')">
                Baixar
            </button>
        </div>
    `).join('');
}

async function downloadVideo(formatId, type, quality) {
    if (!currentVideoUrl) return;

    const btn = event.target;
    const originalText = btn.textContent;
    btn.textContent = 'Baixando...';
    btn.disabled = true;
    btn.style.opacity = '0.6';

    try {
        const params = new URLSearchParams({
            url: currentVideoUrl,
            format_id: formatId.toString(),
            type: type
        });

        const response = await fetch(`/api/download?${params.toString()}`);

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'Erro ao baixar.');
        }

        const contentDisposition = response.headers.get('Content-Disposition');
        let filename = `video_${quality || 'download'}.mp4`;
        if (type === 'audio') filename = `audio_${quality || 'download'}.mp3`;

        if (contentDisposition) {
            const match = contentDisposition.match(/filename="?([^";\n]+)"?/);
            if (match) filename = match[1];
        }

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);

    } catch (error) {
        showError(error.message || 'Erro ao baixar o arquivo. Tente novamente.');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
        btn.style.opacity = '1';
    }
}

function setSearchLoading(loading) {
    if (loading) {
        searchBtn.classList.add('loading');
        searchBtn.disabled = true;
    } else {
        searchBtn.classList.remove('loading');
        searchBtn.disabled = false;
    }
}

function setLinkLoading(loading) {
    if (loading) {
        fetchBtn.classList.add('loading');
        fetchBtn.disabled = true;
    } else {
        fetchBtn.classList.remove('loading');
        fetchBtn.disabled = false;
    }
}

function showError(message) {
    errorText.textContent = message;
    errorMessage.classList.add('show');
}

function hideError() {
    errorMessage.classList.remove('show');
}

function hideVideoInfo() {
    videoInfo.classList.add('hidden');
    videoInfo.style.display = 'none';
}

videoInfo.style.display = 'none';
searchResults.classList.add('hidden');
