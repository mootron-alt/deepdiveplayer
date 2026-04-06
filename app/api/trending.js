// Top music artists via YouTube search scraping

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');

    try {
        var queries = [
            'Drake official music video',
            'Taylor Swift official music video',
            'Kendrick Lamar official music video',
            'Beyonce official music video',
            'The Weeknd official music video',
            'Doja Cat official music video',
            'Post Malone official music video',
            'SZA official music video',
            'Bad Bunny official music video',
            'Dua Lipa official music video',
            'Travis Scott official music video',
            'Billie Eilish official music video',
            'Olivia Rodrigo official music video',
            'Sabrina Carpenter official music video',
            'Morgan Wallen official music video',
            'Kanye West official music video',
        ];

        // Shuffle to vary which artists show up on each refresh
        for (var s = queries.length - 1; s > 0; s--) {
            var k = Math.floor(Math.random() * (s + 1));
            var temp = queries[s];
            queries[s] = queries[k];
            queries[k] = temp;
        }

        var artists = [];

        // Batch: search for each artist, grab first official video
        for (var q = 0; q < queries.length && artists.length < 12; q++) {
            try {
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

                // Get the first video result
                for (var i = 0; i < contents.length; i++) {
                    var items = (contents[i].itemSectionRenderer && contents[i].itemSectionRenderer.contents) || [];
                    var found = false;
                    for (var j = 0; j < items.length; j++) {
                        var r = items[j].videoRenderer;
                        if (!r || !r.videoId) continue;

                        var ch = (r.ownerText && r.ownerText.runs && r.ownerText.runs[0] && r.ownerText.runs[0].text) || '';
                        var name = ch.replace(/ - Topic$/i, '').replace(/VEVO$/i, '').replace(/ Official$/i, '').trim();
                        if (!name) continue;

                        artists.push({
                            name: name,
                            thumbnail: 'https://i.ytimg.com/vi/' + r.videoId + '/hqdefault.jpg',
                            videoTitle: (r.title && r.title.runs && r.title.runs[0] && r.title.runs[0].text) || '',
                        });
                        found = true;
                        break;
                    }
                    if (found) break;
                }
            } catch (e) {
                continue;
            }
        }

        return res.status(200).json({ artists: artists });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};
