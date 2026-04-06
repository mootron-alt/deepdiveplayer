// Scrape Amazon for artist merchandise

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

    var artist = req.query.artist;
    if (!artist) return res.status(400).json({ error: 'Missing artist' });

    try {
        var items = await searchAmazonMerch(artist);
        return res.status(200).json({ items: items });
    } catch (err) {
        return res.status(500).json({ error: err.message, items: [] });
    }
};

async function searchAmazonMerch(artist) {
    var encoded = encodeURIComponent(artist + ' official merchandise');
    var url = 'https://www.amazon.com/s?k=' + encoded + '&i=fashion';

    var response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Accept': 'text/html',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) throw new Error('Amazon returned ' + response.status);
    var html = await response.text();

    var items = [];
    var seen = {};

    // Pattern: find product cards with images, titles, prices, and links
    // Amazon product images are in <img> tags with class containing "s-image"
    var imgPattern = /<img[^>]*class="[^"]*s-image[^"]*"[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi;
    var match;

    while ((match = imgPattern.exec(html)) !== null && items.length < 6) {
        var imgUrl = match[1];
        var title = match[2];

        if (!title || title.length < 10) continue;
        if (seen[title]) continue;
        seen[title] = true;

        // Check title is related to the artist
        var artistFirst = artist.split(' ')[0].toLowerCase();
        if (!title.toLowerCase().includes(artistFirst)) continue;

        // Find the nearest product link (ASIN)
        var asinMatch = html.substring(Math.max(0, match.index - 3000), match.index + 1000).match(/\/dp\/([A-Z0-9]{10})/);
        var productUrl = asinMatch
            ? 'https://www.amazon.com/dp/' + asinMatch[1]
            : 'https://www.amazon.com/s?k=' + encodeURIComponent(artist + ' merch');

        // Find price nearby
        var priceArea = html.substring(match.index, match.index + 2000);
        var priceMatch = priceArea.match(/\$(\d+\.\d{2})/);
        var price = priceMatch ? '$' + priceMatch[1] : '';

        items.push({
            title: title.length > 60 ? title.substring(0, 57) + '...' : title,
            image: imgUrl,
            price: price,
            url: productUrl,
        });
    }

    return items;
}
