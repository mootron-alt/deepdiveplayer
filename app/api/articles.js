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

    // Parse article links from search results
    // Complex uses various patterns — try multiple approaches

    // Pattern 1: Look for article card patterns with titles and URLs
    var linkPattern = /<a[^>]*href="(\/music\/[^"]*|\/pop-culture\/[^"]*|\/pigeons-and-planes\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    var match;
    var seen = {};

    while ((match = linkPattern.exec(html)) !== null && articles.length < 6) {
        var href = match[1];
        var inner = match[2];

        // Skip if we've seen this URL
        if (seen[href]) continue;
        seen[href] = true;

        // Extract text content (strip tags)
        var title = inner.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        if (!title || title.length < 15 || title.length > 200) continue;

        // Check if it's related to the artist
        if (!title.toLowerCase().includes(artist.toLowerCase().split(' ')[0].toLowerCase())) continue;

        articles.push({
            title: title,
            url: 'https://www.complex.com' + href,
            source: 'Complex',
        });
    }

    // Pattern 2: Try JSON-LD or structured data
    if (articles.length === 0) {
        var jsonLdPattern = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi;
        var jsonMatch;
        while ((jsonMatch = jsonLdPattern.exec(html)) !== null) {
            try {
                var jsonData = JSON.parse(jsonMatch[1]);
                var items = Array.isArray(jsonData) ? jsonData : [jsonData];
                for (var i = 0; i < items.length; i++) {
                    if (items[i]['@type'] === 'Article' || items[i]['@type'] === 'NewsArticle') {
                        articles.push({
                            title: items[i].headline || items[i].name || '',
                            url: items[i].url || '',
                            source: 'Complex',
                            image: items[i].image && items[i].image.url ? items[i].image.url : '',
                        });
                    }
                }
            } catch (e) { /* skip bad JSON */ }
        }
    }

    // Pattern 3: Look for og:title and headline patterns
    if (articles.length === 0) {
        // Try to find article titles in meta tags or heading patterns
        var headingPattern = /<h[23][^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h[23]>/gi;
        var hMatch;
        while ((hMatch = headingPattern.exec(html)) !== null && articles.length < 6) {
            var hTitle = hMatch[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
            if (hTitle && hTitle.length > 15) {
                articles.push({
                    title: hTitle,
                    url: 'https://www.complex.com/search?q=' + encoded,
                    source: 'Complex',
                });
            }
        }
    }

    return articles;
}
