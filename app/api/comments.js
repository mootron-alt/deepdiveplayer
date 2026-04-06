// Scrape top YouTube comments for a video

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

    var videoId = req.query.v;
    if (!videoId) return res.status(400).json({ error: 'Missing video ID' });

    try {
        var comments = await scrapeComments(videoId);
        return res.status(200).json({ comments: comments });
    } catch (err) {
        return res.status(500).json({ error: err.message, comments: [] });
    }
};

async function scrapeComments(videoId) {
    var url = 'https://www.youtube.com/watch?v=' + videoId;

    var response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) throw new Error('YouTube returned ' + response.status);
    var html = await response.text();

    // Try to find comments in ytInitialData
    var dataMatch = html.match(/var ytInitialData = ({.*?});<\/script>/s);
    if (!dataMatch) throw new Error('Could not parse page');

    var data = JSON.parse(dataMatch[1]);
    var comments = [];

    // Method 1: Look in engagementPanels for comments
    var panels = data.engagementPanels || [];
    for (var p = 0; p < panels.length; p++) {
        var panel = panels[p].engagementPanelSectionListRenderer;
        if (!panel) continue;
        var content = panel.content;
        if (!content) continue;

        // Navigate through the structured comment data
        var section = content.sectionListRenderer;
        if (!section) continue;
        var sContents = section.contents || [];
        for (var s = 0; s < sContents.length; s++) {
            var itemSection = sContents[s].itemSectionRenderer;
            if (!itemSection) continue;
            var items = itemSection.contents || [];
            for (var i = 0; i < items.length; i++) {
                var comment = extractComment(items[i]);
                if (comment) comments.push(comment);
                if (comments.length >= 15) return comments;
            }
        }
    }

    // Method 2: Look in frameworks/two-column for comment section
    var results = data.contents && data.contents.twoColumnWatchNextResults;
    if (results && results.results && results.results.results) {
        var rContents = results.results.results.contents || [];
        for (var r = 0; r < rContents.length; r++) {
            var itemSection2 = rContents[r].itemSectionRenderer;
            if (!itemSection2) continue;
            var items2 = itemSection2.contents || [];
            for (var i2 = 0; i2 < items2.length; i2++) {
                var comment2 = extractComment(items2[i2]);
                if (comment2) comments.push(comment2);
                if (comments.length >= 15) return comments;
            }
        }
    }

    // Method 3: Deep search the entire JSON for comment threads
    if (comments.length === 0) {
        var jsonStr = JSON.stringify(data);
        var commentMatches = jsonStr.match(/"commentRenderer":\{[^}]*"contentText"/g);
        if (commentMatches && commentMatches.length > 0) {
            // Comments exist but are lazy loaded — we can't get them without a second request
            // Return empty with a note
            return [];
        }
    }

    return comments;
}

function extractComment(item) {
    var renderer = item.commentThreadRenderer;
    if (!renderer) return null;

    var comment = renderer.comment && renderer.comment.commentRenderer;
    if (!comment) return null;

    var authorName = '';
    if (comment.authorText && comment.authorText.simpleText) {
        authorName = comment.authorText.simpleText;
    }

    var text = '';
    if (comment.contentText && comment.contentText.runs) {
        text = comment.contentText.runs.map(function(r) { return r.text; }).join('');
    } else if (comment.contentText && comment.contentText.simpleText) {
        text = comment.contentText.simpleText;
    }

    var likes = '';
    if (comment.voteCount && comment.voteCount.simpleText) {
        likes = comment.voteCount.simpleText;
    }

    var time = '';
    if (comment.publishedTimeText && comment.publishedTimeText.runs) {
        time = comment.publishedTimeText.runs.map(function(r) { return r.text; }).join('');
    }

    if (!text) return null;

    return {
        author: authorName,
        text: text,
        likes: likes,
        time: time,
    };
}
