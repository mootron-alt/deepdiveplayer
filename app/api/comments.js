// Fetch YouTube comments via Invidious API (server-side, no CORS issues)

var INVIDIOUS_INSTANCES = [
    'https://vid.puffyan.us',
    'https://invidious.fdn.fr',
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://iv.ggtyler.dev',
    'https://invidious.privacyredirect.com',
    'https://invidious.protokolla.fi',
];

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

    var videoId = req.query.v;
    if (!videoId) return res.status(400).json({ error: 'Missing video ID' });

    try {
        var comments = await getComments(videoId);
        return res.status(200).json({ comments: comments });
    } catch (err) {
        return res.status(500).json({ error: err.message, comments: [] });
    }
};

async function getComments(videoId) {
    // Try each Invidious instance (server-side — no CORS restriction)
    for (var i = 0; i < INVIDIOUS_INSTANCES.length; i++) {
        try {
            var url = INVIDIOUS_INSTANCES[i] + '/api/v1/comments/' + videoId + '?sort_by=top';
            var resp = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; DeepDivePlayer/1.0)',
                },
                signal: AbortSignal.timeout(5000),
            });

            if (!resp.ok) continue;
            var data = await resp.json();

            if (!data.comments || data.comments.length === 0) continue;

            return data.comments.slice(0, 20).map(function(c) {
                return {
                    author: c.author || '',
                    text: c.content || '',
                    likes: c.likeCount ? c.likeCount.toLocaleString() : '',
                    time: c.publishedText || '',
                };
            });
        } catch (e) {
            continue;
        }
    }

    return [];
}
