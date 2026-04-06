// Top music artists via parallel YouTube search scraping

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');

    try {
        var allArtists = [
            'Drake', 'Taylor Swift', 'Kendrick Lamar', 'Beyonce',
            'The Weeknd', 'Doja Cat', 'Post Malone', 'SZA',
            'Bad Bunny', 'Dua Lipa', 'Travis Scott', 'Billie Eilish',
            'Olivia Rodrigo', 'Sabrina Carpenter', 'Morgan Wallen', 'Kanye West',
        ];

        // Shuffle and pick 12
        for (var s = allArtists.length - 1; s > 0; s--) {
            var k = Math.floor(Math.random() * (s + 1));
            var temp = allArtists[s];
            allArtists[s] = allArtists[k];
            allArtists[k] = temp;
        }
        var selected = allArtists.slice(0, 12);

        // Search ALL artists in parallel
        var results = await Promise.allSettled(selected.map(function(artistName) {
            return searchArtistVideo(artistName);
        }));

        var artists = [];
        for (var i = 0; i < results.length; i++) {
            if (results[i].status === 'fulfilled' && results[i].value) {
                artists.push(results[i].value);
            }
        }

        return res.status(200).json({ artists: artists });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

async function searchArtistVideo(artistName) {
    var encoded = encodeURIComponent(artistName + ' official music video');
    var url = 'https://www.youtube.com/results?search_query=' + encoded;

    var response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) return null;
    var html = await response.text();

    var dataMatch = html.match(/var ytInitialData = ({.*?});<\/script>/s);
    if (!dataMatch) return null;

    var data = JSON.parse(dataMatch[1]);
    var contents = data && data.contents && data.contents.twoColumnSearchResultsRenderer
        && data.contents.twoColumnSearchResultsRenderer.primaryContents
        && data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer
        && data.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents;

    if (!contents) return null;

    for (var i = 0; i < contents.length; i++) {
        var items = (contents[i].itemSectionRenderer && contents[i].itemSectionRenderer.contents) || [];
        for (var j = 0; j < items.length; j++) {
            var r = items[j].videoRenderer;
            if (!r || !r.videoId) continue;

            var ch = (r.ownerText && r.ownerText.runs && r.ownerText.runs[0] && r.ownerText.runs[0].text) || '';
            var name = ch.replace(/ - Topic$/i, '').replace(/VEVO$/i, '').replace(/ Official$/i, '').trim();

            return {
                name: name || artistName,
                thumbnail: 'https://i.ytimg.com/vi/' + r.videoId + '/hqdefault.jpg',
                videoTitle: (r.title && r.title.runs && r.title.runs[0] && r.title.runs[0].text) || '',
            };
        }
    }
    return null;
}
