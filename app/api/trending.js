// Trending music via YouTube search scraping (more reliable than trending page)

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');

    try {
        // Search for popular/trending music videos — more reliable than scraping the trending page
        var queries = [
            'popular music videos this week 2026',
            'trending music videos today',
            'new music videos official',
        ];

        var seen = {};
        var artists = [];

        for (var q = 0; q < queries.length && artists.length < 12; q++) {
            var encoded = encodeURIComponent(queries[q]);
            var url = 'https://www.youtube.com/results?search_query=' + encoded;

            var response = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9',
                },
            });

            if (!response.ok) continue;
            var html = await response.text();

            var dataMatch = html.match(/var ytInitialData = ({.*?});<\/script>/s);
            if (!dataMatch) continue;

            var data = JSON.parse(dataMatch[1]);
            var contents = data && data.contents && data.contents.twoColumnSearchResultsRenderer
                && data.contents.twoColumnSearchResultsRenderer.primaryContents
                && data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer
                && data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents;

            if (!contents) continue;

            for (var i = 0; i < contents.length; i++) {
                var items = (contents[i].itemSectionRenderer && contents[i].itemSectionRenderer.contents) || [];
                for (var j = 0; j < items.length; j++) {
                    var r = items[j].videoRenderer;
                    if (!r || !r.videoId) continue;

                    var ch = (r.ownerText && r.ownerText.runs && r.ownerText.runs[0] && r.ownerText.runs[0].text) || '';
                    var name = ch.replace(/ - Topic$/i, '').replace(/VEVO$/i, '').replace(/Official$/i, '').trim();

                    if (!name || name.length < 2 || seen[name.toLowerCase()]) continue;
                    seen[name.toLowerCase()] = true;

                    artists.push({
                        name: name,
                        thumbnail: 'https://i.ytimg.com/vi/' + r.videoId + '/mqdefault.jpg',
                        videoTitle: (r.title && r.title.runs && r.title.runs[0] && r.title.runs[0].text) || '',
                    });

                    if (artists.length >= 12) break;
                }
                if (artists.length >= 12) break;
            }
        }

        return res.status(200).json({ artists: artists });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
