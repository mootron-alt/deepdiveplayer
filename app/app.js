// ── State ──────────────────────────────────────────────────
const state = {
    apiKey: localStorage.getItem('yt-api-key') || '',
    playlist: [],
    currentIndex: -1,
    player: null,
    playerReady: false,
    isSearching: false,
    clipTimer: null,
    // Artist tracking
    currentArtist: '',
    artistPairsPlayed: 0,     // how many song+interview pairs played for current artist
    usedVideoIds: new Set(),  // avoid duplicates across artists
    artistHistory: [],        // artists we've already played (avoid repeats)
    isAutoQueuing: false,     // are we in the middle of fetching the next artist?
    trendingArtists: [],
    trendingTimer: null,
};

// ── Config ─────────────────────────────────────────────────
const CLIP_DURATION = 30;
const CLIP_SKIP_INTRO = 15;
const USE_SCRAPER = true; // Use serverless scraper instead of YouTube API
const PAIRS_PER_ARTIST = 3;  // 3 songs + 3 interviews = 6 videos, then switch

// ── DOM refs ───────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const apiKeyBanner = $('#api-key-banner');
const apiKeyInput = $('#api-key-input');
const saveKeyBtn = $('#save-key-btn');
const settingsBtn = $('#settings-btn');
const searchInput = $('#search-input');
const searchBtn = $('#search-btn');
const addBtn = $('#add-btn');
const searchStatus = $('#search-status');
const playerWrapper = $('#player-wrapper');
const playerPlaceholder = $('#player-placeholder');
const trendingContainer = $('#trending-container');
const trendingGrid = $('#trending-grid');
const placeholderFallback = $('#placeholder-fallback');
const nowPlaying = $('#now-playing');
const nowPlayingLabel = $('#now-playing-label');
const nowPlayingTitle = $('#now-playing-title');
const clipBadge = $('#clip-badge');
const carouselSection = $('#carousel-section');
const carouselEl = $('#carousel');
const carouselLeft = $('#carousel-left');
const carouselRight = $('#carousel-right');
const socialSidebar = $('#social-sidebar');
const socialArtistName = $('#social-artist-name');
const socialIg = $('#social-ig');
const socialTiktok = $('#social-tiktok');
const socialX = $('#social-x');
const commentsContainer = $('#comments-container');
const articlesSection = $('#articles-section');
const articlesGrid = $('#articles-grid');
const controls = $('#controls');
const prevBtn = $('#prev-btn');
const playPauseBtn = $('#play-pause-btn');
const nextBtn = $('#next-btn');
const skipBtn = $('#skip-btn');
const playlistSection = $('#playlist-section');
const playlistCount = $('#playlist-count');
const playlistEl = $('#playlist');

// ── API Key Management ─────────────────────────────────────
function initApiKey() {
    if (USE_SCRAPER || state.apiKey) {
        apiKeyBanner.classList.add('hidden');
    } else {
        apiKeyBanner.classList.remove('hidden');
    }
}

saveKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key) {
        state.apiKey = key;
        localStorage.setItem('yt-api-key', key);
        apiKeyBanner.classList.add('hidden');
        startTrendingRefresh();
    }
});

apiKeyInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveKeyBtn.click();
});

settingsBtn.addEventListener('click', () => {
    apiKeyBanner.classList.toggle('hidden');
    if (!apiKeyBanner.classList.contains('hidden')) {
        apiKeyInput.value = state.apiKey;
        apiKeyInput.focus();
    }
});

// ── YouTube IFrame API ─────────────────────────────────────
function loadYouTubeAPI() {
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
}

window.onYouTubeIframeAPIReady = function () {
    state.player = new YT.Player('player', {
        height: '100%',
        width: '100%',
        playerVars: {
            autoplay: 0,
            modestbranding: 1,
            rel: 0,
        },
        events: {
            onReady: () => { state.playerReady = true; },
            onStateChange: onPlayerStateChange,
        },
    });
};

function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING) {
        playPauseBtn.innerHTML = '&#9646;&#9646;';
        const current = state.playlist[state.currentIndex];
        if (current?.type === 'interview' && !state.clipTimer) {
            startClipTimer();
        }
    } else {
        playPauseBtn.innerHTML = '&#9654;';
        if (event.data === YT.PlayerState.PAUSED) {
            clearClipTimer();
        }
    }

    if (event.data === YT.PlayerState.ENDED) {
        advancePlaylist();
    }
}

function startClipTimer() {
    clearClipTimer();
    state.clipTimer = setTimeout(() => {
        state.clipTimer = null;
        advancePlaylist();
    }, CLIP_DURATION * 1000);
}

function clearClipTimer() {
    if (state.clipTimer) {
        clearTimeout(state.clipTimer);
        state.clipTimer = null;
    }
}

function advancePlaylist() {
    clearClipTimer();

    // Track pairs played: every time an interview finishes, that's one full pair
    const current = state.playlist[state.currentIndex];
    if (current?.type === 'interview') {
        state.artistPairsPlayed++;
    }

    if (state.currentIndex < state.playlist.length - 1) {
        playItem(state.currentIndex + 1);
    } else {
        // We've reached the end — try to auto-queue a similar artist
        maybeAutoQueueSimilar();
    }

    // Look ahead: if we're about to run out, pre-fetch the next artist
    const remaining = state.playlist.length - 1 - state.currentIndex;
    if (remaining <= 2 && !state.isAutoQueuing) {
        maybeAutoQueueSimilar();
    }
}

// ── API Cache (localStorage, 24h TTL) ──────────────────────
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const CACHE_PREFIX = 'ddp_cache_';

function cacheGet(key) {
    try {
        const raw = localStorage.getItem(CACHE_PREFIX + key);
        if (!raw) return null;
        const { data, ts } = JSON.parse(raw);
        if (Date.now() - ts > CACHE_TTL) {
            localStorage.removeItem(CACHE_PREFIX + key);
            return null;
        }
        return data;
    } catch { return null; }
}

function cacheSet(key, data) {
    try {
        localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
    } catch {
        // localStorage full — clear old cache entries and retry
        clearOldCache();
        try {
            localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, ts: Date.now() }));
        } catch { /* give up */ }
    }
}

function clearOldCache() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith(CACHE_PREFIX)) keys.push(k);
    }
    // Remove oldest half
    keys.sort();
    for (let i = 0; i < Math.ceil(keys.length / 2); i++) {
        localStorage.removeItem(keys[i]);
    }
}

// ── YouTube Search (scraper or API, with cache) ────────────
async function ytSearch(query, maxResults = 5) {
    const cacheKey = `search_${query}_${maxResults}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;

    let results;

    if (USE_SCRAPER) {
        results = await ytSearchScraper(query, maxResults);
    } else {
        results = await ytSearchAPI(query, maxResults);
    }

    cacheSet(cacheKey, results);
    return results;
}

async function ytSearchScraper(query, maxResults) {
    const url = `/api/search?q=${encodeURIComponent(query)}&max=${maxResults}`;
    const res = await fetch(url);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Search failed (${res.status})`);
    }
    const data = await res.json();
    return (data.items || []).map((item) => ({
        id: item.id,
        title: decodeHTMLEntities(item.title || ''),
        thumbnail: item.thumbnail || '',
        channel: item.channel || '',
        description: item.description || '',
    }));
}

async function ytSearchAPI(query, maxResults) {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('q', query);
    url.searchParams.set('type', 'video');
    url.searchParams.set('maxResults', maxResults);
    url.searchParams.set('videoEmbeddable', 'true');
    url.searchParams.set('key', state.apiKey);

    const res = await fetch(url);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `YouTube API error ${res.status}`);
    }
    const data = await res.json();
    return (data.items || []).map((item) => ({
        id: item.id.videoId,
        title: decodeHTMLEntities(item.snippet.title),
        thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
        channel: item.snippet.channelTitle,
        description: item.snippet.description,
    }));
}

function decodeHTMLEntities(text) {
    const el = document.createElement('textarea');
    el.innerHTML = text;
    return el.value;
}

// ── Search Logic ───────────────────────────────────────────
const INTERVIEW_QUERIES = [
    (a, s) => `"${a}" "${s}" interview`,
    (a, s) => `"${a}" "${s}" behind the song`,
    (a, s) => `"${a}" "${s}" making of`,
    (a, s) => `"${a}" talks about "${s}"`,
];

const SHORTS_QUERIES = [
    (a, s) => `${a} ${s} dance #shorts`,
    (a, s) => `${a} ${s} fan #shorts`,
    (a, s) => `${a} ${s} #shorts trend`,
];

const FILTER_OUT = [
    /lyric/i, /karaoke/i, /cover/i, /remix/i, /reaction/i,
    /tutorial/i, /lesson/i, /how to play/i, /drum cover/i,
    /bass cover/i, /guitar cover/i,
];

function isLikelyInterview(title) {
    return !FILTER_OUT.some((re) => re.test(title));
}

// ── Fetch a song + its best interview as a pair ────────────
async function fetchSongPair(artist, songQuery) {
    const musicQuery = songQuery
        ? `${artist} ${songQuery} official music video`
        : `${artist} official music video`;

    const musicResults = await ytSearch(musicQuery, 5);
    // Pick first result we haven't used yet
    const musicVideo = musicResults.find((v) => !state.usedVideoIds.has(v.id));
    if (!musicVideo) return null;

    state.usedVideoIds.add(musicVideo.id);
    musicVideo.type = 'music';
    musicVideo.typeLabel = 'Music Video';
    musicVideo.artist = artist;

    // Search for interview
    const searchSong = songQuery || extractSongFromTitle(musicVideo.title, artist);
    const interviewPromises = INTERVIEW_QUERIES.map((qFn) =>
        ytSearch(qFn(artist, searchSong), 3).catch(() => [])
    );
    const interviewResults = await Promise.all(interviewPromises);

    let bestInterview = null;
    for (const results of interviewResults) {
        for (const vid of results) {
            if (!state.usedVideoIds.has(vid.id) && isLikelyInterview(vid.title)) {
                state.usedVideoIds.add(vid.id);
                bestInterview = vid;
                break;
            }
        }
        if (bestInterview) break;
    }

    if (bestInterview) {
        bestInterview.type = 'interview';
        bestInterview.typeLabel = `Interview · ${CLIP_DURATION}s clip`;
        bestInterview.startAt = CLIP_SKIP_INTRO;
        bestInterview.artist = artist;
    }

    // Search for a fan short / dance short
    const shortsPromises = SHORTS_QUERIES.map((qFn) =>
        ytSearch(qFn(artist, searchSong), 3).catch(() => [])
    );
    const shortsResults = await Promise.all(shortsPromises);

    let bestShort = null;
    for (const results of shortsResults) {
        for (const vid of results) {
            if (!state.usedVideoIds.has(vid.id)) {
                state.usedVideoIds.add(vid.id);
                bestShort = vid;
                break;
            }
        }
        if (bestShort) break;
    }

    if (bestShort) {
        bestShort.type = 'short';
        bestShort.typeLabel = 'Fan Short';
        bestShort.artist = artist;
    }

    return { musicVideo, interview: bestInterview, short: bestShort };
}

// Try to extract song name from a video title like "Artist - Song (Official Video)"
function extractSongFromTitle(title, artist) {
    // Remove artist name and common suffixes
    let clean = title
        .replace(new RegExp(artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '')
        .replace(/\(official.*?\)/i, '')
        .replace(/\[official.*?\]/i, '')
        .replace(/official (music )?video/i, '')
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .replace(/[-–—|]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return clean || title;
}

// ── Fetch multiple pairs for an artist ─────────────────────
async function fetchArtistBlock(artist, numPairs = PAIRS_PER_ARTIST) {
    // First, find top songs by this artist
    const topSongs = await ytSearch(`${artist} official music video`, 10);

    const pairs = [];
    for (const song of topSongs) {
        if (pairs.length >= numPairs) break;
        if (state.usedVideoIds.has(song.id)) continue;

        const songName = extractSongFromTitle(song.title, artist);
        const pair = await fetchSongPair(artist, songName);
        if (pair) pairs.push(pair);
    }

    return pairs;
}

// ── Similar Artist Discovery ───────────────────────────────
async function findSimilarArtist(currentArtist) {
    const queries = [
        `artists similar to ${currentArtist}`,
        `if you like ${currentArtist}`,
        `${currentArtist} similar music`,
    ];

    const allResults = [];
    for (const q of queries) {
        const results = await ytSearch(q, 8).catch(() => []);
        allResults.push(...results);
    }

    // Try to extract artist names from video titles
    // Look for "Artist - Song" or "Artist:" patterns from channels we haven't used
    const candidateArtists = new Set();
    const skipLower = [
        currentArtist.toLowerCase(),
        ...state.artistHistory.map((a) => a.toLowerCase()),
    ];

    for (const vid of allResults) {
        // Use channel name as a candidate if it looks like an artist
        const channel = vid.channel.replace(/ - Topic$/i, '').replace(/VEVO$/i, '').trim();
        if (channel && !skipLower.includes(channel.toLowerCase()) && channel.length > 1) {
            candidateArtists.add(channel);
        }

        // Also try to extract from title ("Artist - Song")
        const titleMatch = vid.title.match(/^([^-–—]+)\s*[-–—]\s*/);
        if (titleMatch) {
            const name = titleMatch[1].trim();
            if (name && !skipLower.includes(name.toLowerCase()) && name.length > 1) {
                candidateArtists.add(name);
            }
        }
    }

    // Return the first candidate that isn't the current artist
    const candidates = [...candidateArtists];
    return candidates.length > 0 ? candidates[0] : null;
}

// ── Auto-Queue Similar Artist ──────────────────────────────
async function maybeAutoQueueSimilar() {
    if (state.isAutoQueuing || !state.currentArtist) return;

    // Only trigger after we've played enough pairs from this artist
    if (state.artistPairsPlayed < PAIRS_PER_ARTIST) return;

    state.isAutoQueuing = true;
    searchStatus.textContent = `Finding an artist similar to ${state.currentArtist}...`;
    searchStatus.className = 'search-status';

    try {
        const similarArtist = await findSimilarArtist(state.currentArtist);

        if (!similarArtist) {
            searchStatus.textContent = `Couldn't find a similar artist. Search for another!`;
            state.isAutoQueuing = false;
            return;
        }

        searchStatus.textContent = `Discovered: ${similarArtist} — loading ${PAIRS_PER_ARTIST} songs...`;

        // Add a divider to the playlist
        state.playlist.push({
            type: 'divider',
            typeLabel: `If you like ${state.currentArtist}...`,
            title: similarArtist,
            artist: similarArtist,
            thumbnail: '',
            id: `divider-${Date.now()}`,
        });

        // Update artist tracking
        state.artistHistory.push(state.currentArtist);
        state.currentArtist = similarArtist;
        state.artistPairsPlayed = 0;

        // Fetch 3 song+interview pairs
        const pairs = await fetchArtistBlock(similarArtist, PAIRS_PER_ARTIST);

        for (const pair of pairs) {
            state.playlist.push(pair.musicVideo);
            if (pair.interview) state.playlist.push(pair.interview);
            if (pair.short) state.playlist.push(pair.short);
        }

        renderPlaylist();

        // If we were at the end and nothing was playing, start the new content
        if (state.currentIndex >= state.playlist.length - pairs.length * 2 - 2) {
            // Find the first music video after the divider
            for (let i = state.currentIndex + 1; i < state.playlist.length; i++) {
                if (state.playlist[i].type === 'music') {
                    playItem(i);
                    break;
                }
            }
        }

        searchStatus.textContent = `Now exploring: ${similarArtist} (${pairs.length} songs queued)`;

    } catch (err) {
        searchStatus.textContent = `Auto-discovery error: ${err.message}`;
        searchStatus.className = 'search-status error';
    } finally {
        state.isAutoQueuing = false;
    }
}

// ── DIVE IN — start fresh ──────────────────────────────────
async function deepDiveSearch(query) {
    if (!USE_SCRAPER && !state.apiKey) {
        apiKeyBanner.classList.remove('hidden');
        apiKeyInput.focus();
        return;
    }

    state.isSearching = true;
    searchBtn.disabled = true;
    addBtn.disabled = true;
    searchStatus.textContent = 'Searching...';
    searchStatus.className = 'search-status';

    try {
        const { artist, song } = parseQuery(query);
        const artistName = artist || query;

        // Reset state
        state.playlist = [];
        state.currentIndex = -1;
        state.currentArtist = artistName;
        state.artistPairsPlayed = 0;
        state.usedVideoIds = new Set();
        state.artistHistory = [];

        searchStatus.textContent = `Loading ${PAIRS_PER_ARTIST} songs by ${artistName}...`;

        // If user gave a specific song, fetch that first, then fill remaining
        let pairs = [];

        if (song) {
            const specificPair = await fetchSongPair(artistName, song);
            if (specificPair) pairs.push(specificPair);
        }

        // Fill up to PAIRS_PER_ARTIST with more songs
        if (pairs.length < PAIRS_PER_ARTIST) {
            const morePairs = await fetchArtistBlock(artistName, PAIRS_PER_ARTIST - pairs.length);
            pairs.push(...morePairs);
        }

        if (pairs.length === 0) {
            throw new Error(`No music videos found for "${query}".`);
        }

        // Build playlist: interleaved music → interview
        for (const pair of pairs) {
            state.playlist.push(pair.musicVideo);
            if (pair.interview) state.playlist.push(pair.interview);
            if (pair.short) state.playlist.push(pair.short);
        }

        renderPlaylist();
        playItem(0);

        searchStatus.textContent = `Playing ${pairs.length} songs by ${artistName} — similar artist queues after!`;

    } catch (err) {
        searchStatus.textContent = err.message;
        searchStatus.className = 'search-status error';
    } finally {
        state.isSearching = false;
        searchBtn.disabled = false;
        addBtn.disabled = false;
    }
}

// ── ADD — append to queue ──────────────────────────────────
async function addToQueue(query) {
    if (!USE_SCRAPER && !state.apiKey) {
        apiKeyBanner.classList.remove('hidden');
        apiKeyInput.focus();
        return;
    }

    state.isSearching = true;
    searchBtn.disabled = true;
    addBtn.disabled = true;
    searchStatus.textContent = `Adding "${query}" to queue...`;
    searchStatus.className = 'search-status';

    try {
        const { artist, song } = parseQuery(query);
        const artistName = artist || query;

        const pair = await fetchSongPair(artistName, song);
        if (!pair) throw new Error(`No music video found for "${query}".`);

        state.playlist.push(pair.musicVideo);
        if (pair.interview) state.playlist.push(pair.interview);

        renderPlaylist();

        if (state.currentIndex === -1) {
            playItem(0);
        }

        searchStatus.textContent = `Queued: ${query} (${state.playlist.length} in playlist)`;

    } catch (err) {
        searchStatus.textContent = err.message;
        searchStatus.className = 'search-status error';
    } finally {
        state.isSearching = false;
        searchBtn.disabled = false;
        addBtn.disabled = false;
    }
}

function parseQuery(query) {
    const separators = [' - ', ' – ', ' by '];
    for (const sep of separators) {
        const idx = query.toLowerCase().indexOf(sep.toLowerCase());
        if (idx > 0) {
            const left = query.slice(0, idx).trim();
            const right = query.slice(idx + sep.length).trim();
            if (sep.toLowerCase() === ' by ') {
                return { artist: right, song: left };
            }
            return { artist: left, song: right };
        }
    }
    return { artist: query, song: '' };
}

// ── Playlist Rendering ─────────────────────────────────────
function renderCarousel() {
    carouselEl.innerHTML = '';

    if (state.playlist.length === 0) {
        carouselSection.classList.add('hidden');
        return;
    }

    carouselSection.classList.remove('hidden');

    state.playlist.forEach((item, i) => {
        // Dividers
        if (item.type === 'divider') {
            const divEl = document.createElement('div');
            divEl.className = 'carousel-divider';
            divEl.innerHTML = `
                <span class="carousel-divider-label">${item.typeLabel}</span>
                <span class="carousel-divider-artist">${item.title}</span>
            `;
            carouselEl.appendChild(divEl);
            return;
        }

        const el = document.createElement('div');
        const isActive = i === state.currentIndex;
        const itemClass = { interview: 'interview-item', short: 'short-item' }[item.type] || '';
        el.className = `carousel-item${isActive ? ' active' : ''}${itemClass ? ' ' + itemClass : ''}`;

        const typeClassMap = { music: 'type-music', interview: 'type-interview', short: 'type-short' };
        const typeClass = typeClassMap[item.type] || 'type-music';
        const typeTextMap = { music: 'Video', interview: `Interview · ${CLIP_DURATION}s`, short: '#Short' };
        const typeText = typeTextMap[item.type] || item.typeLabel;

        el.innerHTML = `
            <img class="carousel-thumb" src="${item.thumbnail}" alt="" loading="lazy">
            <div class="carousel-info">
                <div class="carousel-item-title" title="${item.title}">${item.title}</div>
                <div class="carousel-item-type ${typeClass}">${typeText}</div>
            </div>
        `;

        el.addEventListener('click', () => playItem(i));
        carouselEl.appendChild(el);
    });

    // Scroll active item into view
    requestAnimationFrame(() => {
        const activeEl = carouselEl.querySelector('.carousel-item.active');
        if (activeEl) {
            activeEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    });
}

function renderPlaylist() {
    playlistEl.innerHTML = '';
    playlistSection.classList.remove('hidden');

    const videoCount = state.playlist.filter((i) => i.type !== 'divider').length;
    playlistCount.textContent = `${videoCount} videos`;

    state.playlist.forEach((item, i) => {
        // Render artist divider
        if (item.type === 'divider') {
            const divEl = document.createElement('div');
            divEl.className = 'playlist-divider';
            divEl.innerHTML = `
                <span class="divider-label">${item.typeLabel}</span>
                <span class="divider-artist">${item.title}</span>
            `;
            playlistEl.appendChild(divEl);
            return;
        }

        const el = document.createElement('div');
        const isActive = i === state.currentIndex;
        const plItemClass = { interview: 'interview-item', short: 'short-item' }[item.type] || '';
        el.className = `playlist-item${isActive ? ' active' : ''}${plItemClass ? ' ' + plItemClass : ''}`;

        const clipTag = item.type === 'interview' ? `<span class="clip-tag">${CLIP_DURATION}s</span>` :
                         item.type === 'short' ? '<span class="clip-tag">#short</span>' : '';

        el.innerHTML = `
            <span class="playlist-item-index">${isActive ? '&#9654;' : ''}</span>
            <img class="playlist-item-thumb" src="${item.thumbnail}" alt="" loading="lazy">
            <div class="playlist-item-info">
                <div class="playlist-item-title" title="${item.title}">${item.title}</div>
                <div class="playlist-item-type ${{ music: 'type-music', interview: 'type-interview', short: 'type-short' }[item.type] || ''}">${item.typeLabel} ${clipTag}</div>
            </div>
            <button class="playlist-item-remove" title="Remove">&times;</button>
        `;

        el.addEventListener('click', (e) => {
            if (e.target.closest('.playlist-item-remove')) return;
            playItem(i);
        });

        el.querySelector('.playlist-item-remove').addEventListener('click', () => {
            removeItem(i);
        });

        playlistEl.appendChild(el);
    });

    // Keep carousel in sync
    renderCarousel();
}

function removeItem(index) {
    state.playlist.splice(index, 1);
    if (state.currentIndex === index) {
        clearClipTimer();
        if (state.playlist.length > 0) {
            state.currentIndex = Math.min(index, state.playlist.length - 1);
            // Skip dividers
            while (state.currentIndex < state.playlist.length && state.playlist[state.currentIndex].type === 'divider') {
                state.currentIndex++;
            }
            if (state.currentIndex < state.playlist.length) {
                playItem(state.currentIndex);
            }
        } else {
            state.currentIndex = -1;
            controls.classList.add('hidden');
            nowPlaying.classList.add('hidden');
            playlistSection.classList.add('hidden');
            carouselSection.classList.add('hidden');
        }
    } else if (state.currentIndex > index) {
        state.currentIndex--;
    }
    renderPlaylist();
}

// ── Playback ───────────────────────────────────────────────
function playItem(index) {
    if (index < 0 || index >= state.playlist.length) return;

    // Skip dividers
    if (state.playlist[index].type === 'divider') {
        if (index < state.playlist.length - 1) {
            playItem(index + 1);
        }
        return;
    }

    clearClipTimer();
    state.currentIndex = index;
    const item = state.playlist[index];

    // Load video
    if (state.playerReady) {
        playerPlaceholder.classList.add('hidden');
            playerWrapper.classList.remove('expanded');

        if (item.type === 'interview' && item.startAt) {
            state.player.loadVideoById({
                videoId: item.id,
                startSeconds: item.startAt,
            });
        } else {
            state.player.loadVideoById(item.id);
        }
    }

    // Update now-playing bar
    nowPlaying.classList.remove('hidden');
    const artistTag = item.artist ? `${item.artist} · ` : '';
    const labelMap = { music: 'Music Video', interview: 'Interview', short: 'Fan Short' };
    const classMap = { music: 'music-video', interview: 'interview', short: 'fan-short' };
    nowPlayingLabel.textContent = labelMap[item.type] || item.type;
    nowPlayingLabel.className = `now-playing-label ${classMap[item.type] || ''}`;
    nowPlayingTitle.textContent = `${artistTag}${item.title}`;

    // Show/hide clip badge
    if (item.type === 'interview') {
        clipBadge.textContent = `${CLIP_DURATION}s clip`;
        clipBadge.classList.remove('hidden');
    } else if (item.type === 'short') {
        clipBadge.textContent = '#short';
        clipBadge.classList.remove('hidden');
    } else {
        clipBadge.classList.add('hidden');
    }

    controls.classList.remove('hidden');

    // Update social sidebar
    if (item.artist) {
        updateSocialSidebar(item.artist, item.id);
        updateShopLinks(item.artist);
        loadArticles(item.artist);
    }

    renderPlaylist();
}

// ── Controls ───────────────────────────────────────────────
prevBtn.addEventListener('click', () => {
    let target = state.currentIndex - 1;
    while (target >= 0 && state.playlist[target]?.type === 'divider') target--;
    if (target >= 0) playItem(target);
});

nextBtn.addEventListener('click', () => {
    let target = state.currentIndex + 1;
    while (target < state.playlist.length && state.playlist[target]?.type === 'divider') target++;
    if (target < state.playlist.length) playItem(target);
});

skipBtn.addEventListener('click', () => {
    advancePlaylist();
});

playPauseBtn.addEventListener('click', () => {
    if (!state.playerReady) return;
    const ps = state.player.getPlayerState();
    if (ps === YT.PlayerState.PLAYING) {
        state.player.pauseVideo();
    } else {
        state.player.playVideo();
    }
});

// ── Carousel Scroll ────────────────────────────────────────
carouselLeft.addEventListener('click', () => {
    carouselEl.scrollBy({ left: -300, behavior: 'smooth' });
});

carouselRight.addEventListener('click', () => {
    carouselEl.scrollBy({ left: 300, behavior: 'smooth' });
});

// ── Search Events ──────────────────────────────────────────
searchBtn.addEventListener('click', () => {
    const q = searchInput.value.trim();
    if (q && !state.isSearching) deepDiveSearch(q);
});

addBtn.addEventListener('click', () => {
    const q = searchInput.value.trim();
    if (q && !state.isSearching) addToQueue(q);
});

searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const q = searchInput.value.trim();
        if (q && !state.isSearching) deepDiveSearch(q);
    }
});

// ── Articles (Complex.com) ─────────────────────────────────
let lastArticleArtist = '';

async function loadArticles(artist) {
    if (!artist || artist === lastArticleArtist) return;
    lastArticleArtist = artist;

    articlesSection.classList.remove('hidden');
    articlesGrid.innerHTML = '<span class="articles-empty">Loading articles...</span>';

    const cacheKey = `articles_${artist}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
        renderArticles(cached, artist);
        return;
    }

    try {
        const res = await fetch(`/api/articles?artist=${encodeURIComponent(artist)}`);
        const data = await res.json();
        const articles = data.articles || [];
        if (articles.length > 0) cacheSet(cacheKey, articles);
        renderArticles(articles, artist);
    } catch {
        renderArticles([], artist);
    }
}

function renderArticles(articles, artist) {
    articlesGrid.innerHTML = '';

    if (articles.length === 0) {
        // Show a direct link to Complex search as fallback
        articlesGrid.innerHTML = `
            <a class="article-card" href="https://www.complex.com/search?q=${encodeURIComponent(artist)}" target="_blank" rel="noopener">
                <div class="article-card-body">
                    <span class="article-card-title">Search Complex for ${artist}</span>
                    <span class="article-card-source">Complex &#8599;</span>
                </div>
            </a>
        `;
        return;
    }

    for (const article of articles) {
        const card = document.createElement('a');
        card.className = 'article-card';
        card.href = article.url;
        card.target = '_blank';
        card.rel = 'noopener';
        card.innerHTML = `
            <div class="article-card-body">
                <span class="article-card-title">${escapeHtml(article.title)}</span>
                <span class="article-card-source">${article.source || 'Complex'} &#8599;</span>
            </div>
        `;
        articlesGrid.appendChild(card);
    }
}

// ── Shop Links ─────────────────────────────────────────────
const shopSection = $('#shop-section');
const shopLinks = $('#shop-links');
let lastShopArtist = '';

function updateShopLinks(artist) {
    if (!artist || artist === lastShopArtist) return;
    lastShopArtist = artist;

    shopSection.classList.remove('hidden');
    const encoded = encodeURIComponent(artist);

    shopLinks.innerHTML = `
        <a class="shop-link" href="https://www.google.com/search?q=${encoded}+official+merch+store" target="_blank" rel="noopener">
            <span class="shop-link-icon">&#9733;</span>
            <span class="shop-link-label">Official Merch Store</span>
            <span class="shop-link-arrow">&#8599;</span>
        </a>
    `;
}

// ── Social Sidebar ─────────────────────────────────────────
let lastSocialArtist = '';
let lastCommentVideoId = '';

function updateSocialSidebar(artist, videoId) {
    socialSidebar.classList.remove('hidden');

    if (artist && artist !== lastSocialArtist) {
        lastSocialArtist = artist;
        socialArtistName.textContent = artist;

        const encoded = encodeURIComponent(artist);
        socialIg.href = `https://www.instagram.com/explore/tags/${encoded.replace(/%20/g, '')}/`;
        socialTiktok.href = `https://www.tiktok.com/search?q=${encoded}`;
        socialX.href = `https://x.com/search?q=${encoded}&f=top`;
    }

    // Load comments for the current video
    if (videoId && videoId !== lastCommentVideoId) {
        lastCommentVideoId = videoId;
        loadComments(videoId);
    }
}

async function loadComments(videoId) {
    commentsContainer.innerHTML = '<p class="comments-loading">Loading comments...</p>';

    // Check cache
    const cacheKey = `comments_${videoId}`;
    const cached = cacheGet(cacheKey);
    if (cached) {
        renderComments(cached, videoId);
        return;
    }

    try {
        const res = await fetch(`/api/comments?v=${videoId}`);
        const data = await res.json();
        const comments = data.comments || [];

        if (comments.length > 0) {
            cacheSet(cacheKey, comments);
        }
        renderComments(comments, videoId);
    } catch (err) {
        renderComments([], videoId);
    }
}

function renderComments(comments, videoId) {
    commentsContainer.innerHTML = '';

    if (comments.length === 0) {
        commentsContainer.innerHTML = `
            <div class="comments-fallback">
                <p>Comments not available for this video</p>
                <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank" rel="noopener">View on YouTube &#8599;</a>
            </div>
        `;
        return;
    }

    for (const c of comments) {
        const card = document.createElement('div');
        card.className = 'comment-card';

        const likesHtml = c.likes ? `<span class="comment-likes">${c.likes} likes</span>` : '';
        const timeHtml = c.time ? `<span>${c.time}</span>` : '';

        card.innerHTML = `
            <span class="comment-author">${escapeHtml(c.author)}</span>
            <span class="comment-text">${escapeHtml(c.text)}</span>
            <div class="comment-meta">${likesHtml}${timeHtml}</div>
        `;
        commentsContainer.appendChild(card);
    }
}

function escapeHtml(str) {
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
}

// ── Trending Artists ────────────────────────────────────────
const TRENDING_REFRESH_MS = 15 * 60 * 1000; // 15 minutes

async function fetchTrendingArtists() {
    // Check cache first
    const trendingCacheKey = 'trending_music_us';
    const cachedTrending = cacheGet(trendingCacheKey);
    if (cachedTrending) {
        state.trendingArtists = cachedTrending;
        renderTrendingGrid();
        return;
    }

    if (USE_SCRAPER) {
        await fetchTrendingScraper(trendingCacheKey);
    } else {
        if (!state.apiKey) return;
        await fetchTrendingAPI(trendingCacheKey);
    }
}

async function fetchTrendingScraper(cacheKey) {
    try {
        const res = await fetch('/api/trending');
        if (!res.ok) {
            showTrendingFallback('error');
            return;
        }
        const data = await res.json();
        state.trendingArtists = (data.artists || []).slice(0, 12);
        cacheSet(cacheKey, state.trendingArtists);
        renderTrendingGrid();
    } catch (err) {
        console.warn('Trending scrape failed:', err);
        showTrendingFallback('error');
    }
}

async function fetchTrendingAPI(cacheKey) {
    try {
        const url = new URL('https://www.googleapis.com/youtube/v3/videos');
        url.searchParams.set('part', 'snippet');
        url.searchParams.set('chart', 'mostPopular');
        url.searchParams.set('videoCategoryId', '10');
        url.searchParams.set('regionCode', 'US');
        url.searchParams.set('maxResults', '24');
        url.searchParams.set('key', state.apiKey);

        const res = await fetch(url);
        const data = await res.json();

        if (data.error) {
            const msg = data.error.message || '';
            showTrendingFallback(msg.includes('quota') ? 'quota' : 'error');
            return;
        }

        const seen = new Set();
        const artists = [];

        for (const item of (data.items || [])) {
            let name = item.snippet.channelTitle
                .replace(/ - Topic$/i, '')
                .replace(/VEVO$/i, '')
                .replace(/Official$/i, '')
                .trim();

            const nameLower = name.toLowerCase();
            if (!seen.has(nameLower) && name.length > 1) {
                seen.add(nameLower);
                artists.push({
                    name,
                    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
                    videoTitle: decodeHTMLEntities(item.snippet.title),
                });
            }
        }

        state.trendingArtists = artists.slice(0, 12);
        cacheSet(cacheKey, state.trendingArtists);
        renderTrendingGrid();
    } catch (err) {
        console.warn('Trending API failed:', err);
    }
}

function renderTrendingGrid() {
    if (state.trendingArtists.length === 0) {
        trendingContainer.classList.add('hidden');
        placeholderFallback.classList.remove('hidden');
        return;
    }

    placeholderFallback.classList.add('hidden');
    trendingContainer.classList.remove('hidden');
    playerWrapper.classList.add('expanded');

    // Fade out
    trendingGrid.classList.add('fade-out');
    trendingGrid.classList.remove('fade-in');

    setTimeout(() => {
        trendingGrid.innerHTML = '';

        for (const artist of state.trendingArtists) {
            const card = document.createElement('div');
            card.className = 'trending-card';
            card.innerHTML = `
                <img class="trending-thumb" src="${artist.thumbnail}" alt="${artist.name}" loading="lazy">
                <div class="trending-name" title="${artist.name}">${artist.name}</div>
            `;
            card.addEventListener('click', () => {
                searchInput.value = artist.name;
                deepDiveSearch(artist.name);
            });
            trendingGrid.appendChild(card);
        }

        // Fade in
        trendingGrid.classList.remove('fade-out');
        trendingGrid.classList.add('fade-in');
    }, 400);
}

function showTrendingFallback(reason) {
    placeholderFallback.classList.add('hidden');
    trendingContainer.classList.remove('hidden');
    playerWrapper.classList.add('expanded');

    if (reason === 'quota') {
        trendingGrid.innerHTML = `
            <div class="trending-fallback">
                <div class="trending-fallback-icon">&#9888;</div>
                <p class="trending-fallback-title">API Quota Reached</p>
                <p class="trending-fallback-text">YouTube's daily limit has been hit. Trending artists will refresh when the quota resets at midnight PT.</p>
                <p class="trending-fallback-text">You can still search for any artist above!</p>
            </div>
        `;
    } else {
        trendingGrid.innerHTML = `
            <div class="trending-fallback">
                <div class="trending-fallback-icon">&#9888;</div>
                <p class="trending-fallback-title">Couldn't load trending artists</p>
                <p class="trending-fallback-text">Search for any artist above to start your deep dive!</p>
            </div>
        `;
    }
}

function startTrendingRefresh() {
    if (!USE_SCRAPER && !state.apiKey) return;

    fetchTrendingArtists();

    if (state.trendingTimer) clearInterval(state.trendingTimer);
    state.trendingTimer = setInterval(() => {
        // Only refresh if we're still on the landing page (player placeholder visible)
        if (!playerPlaceholder.classList.contains('hidden')) {
            fetchTrendingArtists();
        }
    }, TRENDING_REFRESH_MS);
}

// ── Init ───────────────────────────────────────────────────
initApiKey();
loadYouTubeAPI();
startTrendingRefresh();
