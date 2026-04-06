// Scrape news articles about an artist via Google News

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

    var artist = req.query.artist;
    if (!artist) return res.status(400).json({ error: 'Missing artist' });

    try {
        var articles = await searchNews(artist);
        return res.status(200).json({ articles: articles });
    } catch (err) {
        return res.status(500).json({ error: err.message, articles: [] });
    }
};

async function searchNews(artist) {
    // Use Google search with news tab to find recent articles
    var encoded = encodeURIComponent(artist + ' music news');
    var url = 'https://www.google.com/search?q=' + encoded + '&tbm=nws&hl=en';

    var response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Accept': 'text/html',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) throw new Error('Google returned ' + response.status);
    var html = await response.text();

    var articles = [];

    // Google News results have links with article titles
    // Pattern: find <a> tags that link to external sites with nearby text
    var linkPattern = /<a[^>]*href="\/url\?q=(https?:\/\/[^&"]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    var match;
    var seen = {};

    while ((match = linkPattern.exec(html)) !== null && articles.length < 6) {
        var rawUrl = decodeURIComponent(match[1]);
        var inner = match[2];

        // Skip Google's own URLs
        if (rawUrl.includes('google.com') || rawUrl.includes('youtube.com')) continue;
        if (seen[rawUrl]) continue;
        seen[rawUrl] = true;

        var title = inner.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        if (!title || title.length < 15 || title.length > 200) continue;

        // Extract source name from URL
        var sourceMatch = rawUrl.match(/https?:\/\/(?:www\.)?([^\/]+)/);
        var source = sourceMatch ? sourceMatch[1].replace(/\.com$|\.org$|\.net$/, '') : '';

        // Look for image nearby
        var context = html.substring(Math.max(0, match.index - 1000), match.index + 1000);
        var imgMatch = context.match(/src="(https:\/\/[^"]*(?:encrypted|lh3|gstatic)[^"]*\.(?:jpg|jpeg|png|webp|gif)[^"]*)"/i);
        var image = imgMatch ? imgMatch[1] : '';

        articles.push({
            title: title.length > 80 ? title.substring(0, 77) + '...' : title,
            url: rawUrl,
            image: image,
            source: source.charAt(0).toUpperCase() + source.slice(1),
        });
    }

    // Fallback: try a simpler pattern if Google changed their format
    if (articles.length === 0) {
        var simplePattern = /<a[^>]*href="(https?:\/\/(?!google|youtube)[^"]+)"[^>]*>([^<]{20,150})<\/a>/gi;
        var sMatch;
        while ((sMatch = simplePattern.exec(html)) !== null && articles.length < 6) {
            var sUrl = sMatch[1];
            var sTitle = sMatch[2].trim();
            if (seen[sUrl]) continue;
            seen[sUrl] = true;

            var sSource = sUrl.match(/https?:\/\/(?:www\.)?([^\/]+)/);
            articles.push({
                title: sTitle,
                url: sUrl,
                image: '',
                source: sSource ? sSource[1].replace(/\.com$/, '') : '',
            });
        }
    }

    return articles;
}
