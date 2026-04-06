module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

    const { q, max } = req.query;
    if (!q) return res.status(400).json({ error: 'Missing q' });

    const maxResults = Math.min(parseInt(max) || 10, 20);

    try {
        const encoded = encodeURIComponent(q);
        const url = 'https://www.youtube.com/results?search_query=' + encoded;
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        });

        if (!response.ok) throw new Error('YouTube returned ' + response.status);
        var html = await response.text();

        var dataMatch = html.match(/var ytInitialData = ({.*?});<\/script>/s);
        if (!dataMatch) throw new Error('Could not parse YouTube response');

        var data = JSON.parse(dataMatch[1]);
        var contents = data && data.contents && data.contents.twoColumnSearchResultsRenderer
            && data.contents.twoColumnSearchResultsRenderer.primaryContents
            && data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer
            && data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents;

        if (!contents) return res.status(200).json({ items: [] });

        var videos = [];
        for (var i = 0; i < contents.length; i++) {
            var items = (contents[i].itemSectionRenderer && contents[i].itemSectionRenderer.contents) || [];
            for (var j = 0; j < items.length; j++) {
                var r = items[j].videoRenderer;
                if (!r || !r.videoId) continue;
                videos.push({
                    id: r.videoId,
                    title: (r.title && r.title.runs && r.title.runs[0] && r.title.runs[0].text) || '',
                    thumbnail: 'https://i.ytimg.com/vi/' + r.videoId + '/mqdefault.jpg',
                    channel: (r.ownerText && r.ownerText.runs && r.ownerText.runs[0] && r.ownerText.runs[0].text) || '',
                    description: '',
                });
                if (videos.length >= maxResults) break;
            }
            if (videos.length >= maxResults) break;
        }

        return res.status(200).json({ items: videos });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
