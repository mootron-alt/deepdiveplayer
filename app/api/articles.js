// Scrape Complex.com articles about an artist

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

    var artist = req.query.artist;
    if (!artist) return res.status(400).json({ error: 'Missing artist' });

    try {
        var articles = await searchComplex(artist);
        return res.status(200).json({ articles: articles });
    } catch (err) {
        return res.status(500).json({ error: err.message, articles: [] });
    }
};

async function searchComplex(artist) {
    var encoded = encodeURIComponent(artist);
    var url = 'https://www.complex.com/search?q=' + encoded;

    var response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Accept': 'text/html',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) throw new Error('Complex returned ' + response.status);
    var html = await response.text();

    var articles = [];
    var seen = {};
    var artistFirst = artist.split(' ')[0].toLowerCase();

    // Find article cards — look for links to article pages with nearby images
    // Complex article URLs follow patterns like /music/..., /pop-culture/...
    var cardPattern = /<a[^>]*href="(\/(music|pop-culture|pigeons-and-planes|life|sneakers)\/[a-z0-9-]+\/[a-z0-9-]+)"[^>]*>/gi;
    var match;

    while ((match = cardPattern.exec(html)) !== null && articles.length < 6) {
        var href = match[1];
        if (seen[href]) continue;
        seen[href] = true;

        // Get surrounding context (3000 chars around the link)
        var start = Math.max(0, match.index - 1500);
        var end = Math.min(html.length, match.index + 1500);
        var context = html.substring(start, end);

        // Extract title from nearby text
        var titleMatch = context.match(/(?:title|alt|aria-label)="([^"]{15,200})"/i);
        var title = titleMatch ? titleMatch[1] : '';

        // Also try heading tags
        if (!title) {
            var headingMatch = context.match(/<h[2-4][^>]*>([\s\S]{10,200}?)<\/h[2-4]>/i);
            if (headingMatch) {
                title = headingMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
            }
        }

        if (!title || !title.toLowerCase().includes(artistFirst)) continue;

        // Extract image from nearby img tags
        var imgMatch = context.match(/<img[^>]*src="(https:\/\/[^"]*(?:images|media|cdn)[^"]*\.(jpg|jpeg|png|webp)[^"]*)"/i);
        var image = imgMatch ? imgMatch[1] : '';

        // Also try srcset or data-src
        if (!image) {
            var srcsetMatch = context.match(/(?:srcset|data-src)="(https:\/\/[^"]*\.(jpg|jpeg|png|webp)[^" ]*)"/i);
            image = srcsetMatch ? srcsetMatch[1] : '';
        }

        articles.push({
            title: title.length > 80 ? title.substring(0, 77) + '...' : title,
            url: 'https://www.complex.com' + href,
            image: image,
            source: 'Complex',
        });
    }

    return articles;
}
