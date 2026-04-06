// Vercel Serverless Function — YouTube trending music via scraping
// No API key needed. Scrapes YouTube's trending music page.

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800'); // 15min cache

    try {
        const artists = await scrapeTrendingMusic();
        return res.status(200).json({ artists });
    } catch (err) {
        console.error('Trending scrape error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch trending', message: err.message });
    }
}

async function scrapeTrendingMusic() {
    // YouTube trending music page
    const url = 'https://www.youtube.com/feed/trending?bp=4gINGgt5dG1hX2NoYXJ0cw%3D%3D';

    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) {
        throw new Error(`YouTube returned ${response.status}`);
    }

    const html = await response.text();

    const dataMatch = html.match(/var ytInitialData = ({.*?});<\/script>/s);
    if (!dataMatch) {
        throw new Error('Could not parse YouTube trending page');
    }

    const data = JSON.parse(dataMatch[1]);

    // Navigate trending page structure
    const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    const seen = new Set();
    const artists = [];

    for (const tab of tabs) {
        const sections = tab?.tabRenderer?.content?.sectionListRenderer?.contents || [];
        for (const section of sections) {
            const items = section?.itemSectionRenderer?.contents || [];
            for (const item of items) {
                // Could be shelfRenderer or videoRenderer
                const shelf = item?.shelfRenderer?.content?.expandedShelfContentsRenderer?.items ||
                              [item];

                for (const entry of shelf) {
                    const renderer = entry?.videoRenderer;
                    if (!renderer) continue;

                    const channel = renderer?.ownerText?.runs?.[0]?.text || '';
                    const name = channel
                        .replace(/ - Topic$/i, '')
                        .replace(/VEVO$/i, '')
                        .replace(/Official$/i, '')
                        .trim();

                    if (!name || seen.has(name.toLowerCase())) continue;
                    seen.add(name.toLowerCase());

                    const videoId = renderer.videoId || '';
                    const thumbnail =
                        renderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url ||
                        (videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : '');

                    artists.push({
                        name,
                        thumbnail,
                        videoTitle: renderer?.title?.runs?.[0]?.text || '',
                    });

                    if (artists.length >= 12) break;
                }
                if (artists.length >= 12) break;
            }
            if (artists.length >= 12) break;
        }
        if (artists.length >= 12) break;
    }

    return artists;
}
