// Vercel Serverless Function — YouTube search proxy via scraping

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

    const { q, max } = req.query;
    if (!q) {
        return res.status(400).json({ error: 'Missing query parameter "q"' });
    }

    const maxResults = Math.min(parseInt(max) || 10, 20);

    try {
        const results = await scrapeYouTubeSearch(q, maxResults);
        return res.status(200).json({ items: results });
    } catch (err) {
        console.error('Scrape error:', err.message);
        return res.status(500).json({ error: 'Search failed', message: err.message });
    }
};

async function scrapeYouTubeSearch(query, maxResults) {
    const encoded = encodeURIComponent(query);
    const url = `https://www.youtube.com/results?search_query=${encoded}`;

    const response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) {
        throw new Error('YouTube returned ' + response.status);
    }

    const html = await response.text();

    // YouTube embeds initial data as JSON in a script tag
    const dataMatch = html.match(/var ytInitialData = ({.*?});<\/script>/s);
    if (!dataMatch) {
        throw new Error('Could not parse YouTube response');
    }

    const data = JSON.parse(dataMatch[1]);

    const contents = data
        && data.contents
        && data.contents.twoColumnSearchResultsRenderer
        && data.contents.twoColumnSearchResultsRenderer.primaryContents
        && data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer
        && data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents;

    if (!contents) return [];

    const videos = [];

    for (var i = 0; i < contents.length; i++) {
        var items = (contents[i].itemSectionRenderer && contents[i].itemSectionRenderer.contents) || [];
        for (var j = 0; j < items.length; j++) {
            var renderer = items[j].videoRenderer;
            if (!renderer) continue;

            var videoId = renderer.videoId;
            if (!videoId) continue;

            var title = (renderer.title && renderer.title.runs && renderer.title.runs[0] && renderer.title.runs[0].text) || '';
            var channel = (renderer.ownerText && renderer.ownerText.runs && renderer.ownerText.runs[0] && renderer.ownerText.runs[0].text) || '';
            var thumbs = renderer.thumbnail && renderer.thumbnail.thumbnails;
            var thumbnail = (thumbs && thumbs.length > 0 && thumbs[thumbs.length - 1].url) || ('https://i.ytimg.com/vi/' + videoId + '/mqdefault.jpg');
            var snippetRuns = renderer.detailedMetadataSnippets && renderer.detailedMetadataSnippets[0] && renderer.detailedMetadataSnippets[0].snippetText && renderer.detailedMetadataSnippets[0].snippetText.runs;
            var description = snippetRuns ? snippetRuns.map(function(r) { return r.text; }).join('') : '';

            videos.push({
                id: videoId,
                title: title,
                thumbnail: thumbnail,
                channel: channel,
                description: description,
            });

            if (videos.length >= maxResults) break;
        }
        if (videos.length >= maxResults) break;
    }

    return videos;
}
