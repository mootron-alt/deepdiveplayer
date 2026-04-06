// Top US music artists via YouTube search scraping

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');

    try {
        // Target actual charting artists — Billboard, Spotify top hits, etc.
        var queries = [
            'Billboard Hot 100 official music video 2026',
            'Spotify top hits official music video',
            'top songs USA official music video 2026',
            'number one hit official music video 2026',
        ];

        // Filter out non-artist channels
        var skipChannels = /playlist|hits|music\s*mix|compilation|top\s*\d|best of|collection|remix|deep house|lofi|lo-fi|beat|instrumental|karaoke|lyrics only|reaction|vlog|funny|status|short|tutorial|countdown|radio|records|entertainment|media|network|magazine|billboard|spotify/i;

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

                    var title = (r.title && r.title.runs && r.title.runs[0] && r.title.runs[0].text) || '';
                    var ch = (r.ownerText && r.ownerText.runs && r.ownerText.runs[0] && r.ownerText.runs[0].text) || '';

                    // Must have "official" in the title to be an actual artist video
                    if (!title.toLowerCase().includes('official')) continue;

                    var name = ch.replace(/ - Topic$/i, '').replace(/VEVO$/i, '').replace(/ Official$/i, '').trim();

                    if (!name || name.length < 2 || seen[name.toLowerCase()]) continue;
                    if (skipChannels.test(name)) continue;

                    seen[name.toLowerCase()] = true;

                    artists.push({
                        name: name,
                        thumbnail: 'https://i.ytimg.com/vi/' + r.videoId + '/mqdefault.jpg',
                        videoTitle: title,
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
