// Scrape top YouTube comments using continuation token

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
    // Step 1: Load the video page to get the continuation token for comments
    var pageUrl = 'https://www.youtube.com/watch?v=' + videoId;
    var pageRes = await fetch(pageUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!pageRes.ok) throw new Error('YouTube returned ' + pageRes.status);
    var html = await pageRes.text();

    // Extract the continuation token for comments
    // YouTube puts it in ytInitialData as a continuation item
    var tokenMatch = html.match(/"continuationCommand":\{"token":"([^"]+)"[^}]*"request":"CONTINUATION_REQUEST_TYPE_WATCH_NEXT"/);
    if (!tokenMatch) {
        // Try alternate pattern
        tokenMatch = html.match(/"token":"([^"]+)"[^}]*?"targetId":"comments-section"/);
    }
    if (!tokenMatch) {
        // Try broader pattern — look for comment continuation tokens
        tokenMatch = html.match(/"token":"(Eg[A-Za-z0-9_-]+)"[^}]*?"label":"[^"]*[Cc]omment/);
    }
    if (!tokenMatch) {
        // Last resort: find any continuation near "comment"
        var commentIdx = html.indexOf('comment-item-section');
        if (commentIdx === -1) commentIdx = html.indexOf('comments-section');
        if (commentIdx > -1) {
            var nearby = html.substring(Math.max(0, commentIdx - 2000), commentIdx + 2000);
            var nearToken = nearby.match(/"continuation":"([^"]+)"/);
            if (!nearToken) nearToken = nearby.match(/"token":"([^"]+)"/);
            if (nearToken) tokenMatch = nearToken;
        }
    }

    if (!tokenMatch) return [];

    var continuationToken = tokenMatch[1];

    // Also extract API key from page
    var apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    var apiKey = apiKeyMatch ? apiKeyMatch[1] : 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

    // Step 2: Fetch comments using YouTube's internal API
    var commentsUrl = 'https://www.youtube.com/youtubei/v1/next?key=' + apiKey;
    var commentsRes = await fetch(commentsUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        body: JSON.stringify({
            context: {
                client: {
                    clientName: 'WEB',
                    clientVersion: '2.20240101.00.00',
                    hl: 'en',
                    gl: 'US',
                },
            },
            continuation: continuationToken,
        }),
    });

    if (!commentsRes.ok) return [];
    var commentsData = await commentsRes.json();

    // Step 3: Parse the comment data
    var comments = [];
    var jsonStr = JSON.stringify(commentsData);

    // Find all commentRenderer objects
    var endpoints = commentsData.onResponseReceivedEndpoints || [];
    for (var e = 0; e < endpoints.length; e++) {
        var actions = endpoints[e].reloadContinuationItemsCommand;
        if (!actions) actions = endpoints[e].appendContinuationItemsAction;
        if (!actions) continue;

        var contItems = actions.continuationItems || [];
        for (var c = 0; c < contItems.length; c++) {
            var thread = contItems[c].commentThreadRenderer;
            if (!thread) continue;

            var renderer = thread.comment && thread.comment.commentRenderer;
            if (!renderer) continue;

            var author = '';
            if (renderer.authorText && renderer.authorText.simpleText) {
                author = renderer.authorText.simpleText;
            }

            var text = '';
            if (renderer.contentText && renderer.contentText.runs) {
                text = renderer.contentText.runs.map(function(r) { return r.text; }).join('');
            }

            var likes = '';
            if (renderer.voteCount && renderer.voteCount.simpleText) {
                likes = renderer.voteCount.simpleText;
            }

            var time = '';
            if (renderer.publishedTimeText && renderer.publishedTimeText.runs) {
                time = renderer.publishedTimeText.runs.map(function(r) { return r.text; }).join('');
            }

            if (text) {
                comments.push({
                    author: author,
                    text: text,
                    likes: likes,
                    time: time,
                });
            }

            if (comments.length >= 20) return comments;
        }
    }

    return comments;
}
