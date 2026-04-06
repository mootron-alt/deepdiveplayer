// Scrape top YouTube comments using continuation token

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

    var videoId = req.query.v;
    var debug = req.query.debug === '1';
    if (!videoId) return res.status(400).json({ error: 'Missing video ID' });

    try {
        var result = await scrapeComments(videoId, debug);
        return res.status(200).json(result);
    } catch (err) {
        return res.status(500).json({ error: err.message, comments: [] });
    }
};

async function scrapeComments(videoId, debug) {
    var pageUrl = 'https://www.youtube.com/watch?v=' + videoId;
    var pageRes = await fetch(pageUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!pageRes.ok) throw new Error('YouTube returned ' + pageRes.status);
    var html = await pageRes.text();

    var dataMatch = html.match(/var ytInitialData = ({.*?});<\/script>/s);
    if (!dataMatch) throw new Error('Could not parse page');

    var data = JSON.parse(dataMatch[1]);

    // Find ALL continuation tokens and try to identify the comments one
    var allTokens = [];
    findTokens(data, allTokens, '');

    // Filter for tokens that look like comment continuations (start with "Eg")
    var commentTokens = allTokens.filter(function(t) {
        return t.token.indexOf('Eg') === 0 && t.token.length > 50;
    });

    // Also extract API key
    var apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    var apiKey = apiKeyMatch ? apiKeyMatch[1] : 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

    if (debug) {
        return {
            comments: [],
            debug: {
                totalTokens: allTokens.length,
                commentTokens: commentTokens.length,
                tokenPaths: commentTokens.slice(0, 5).map(function(t) {
                    return { path: t.path, tokenPrefix: t.token.substring(0, 30) };
                }),
                apiKey: apiKey.substring(0, 10) + '...',
            },
        };
    }

    // Try each comment-looking token
    for (var i = 0; i < commentTokens.length; i++) {
        var comments = await fetchWithToken(commentTokens[i].token, apiKey);
        if (comments.length > 0) return { comments: comments };
    }

    // If no Eg tokens worked, try ALL tokens
    for (var j = 0; j < Math.min(allTokens.length, 10); j++) {
        var comments2 = await fetchWithToken(allTokens[j].token, apiKey);
        if (comments2.length > 0) return { comments: comments2 };
    }

    return { comments: [] };
}

function findTokens(obj, results, path) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
        for (var i = 0; i < obj.length; i++) {
            findTokens(obj[i], results, path + '[' + i + ']');
        }
        return;
    }
    for (var key in obj) {
        if (key === 'token' && typeof obj[key] === 'string' && obj[key].length > 20) {
            results.push({ token: obj[key], path: path + '.' + key });
        } else if (key === 'continuation' && typeof obj[key] === 'string' && obj[key].length > 20) {
            results.push({ token: obj[key], path: path + '.' + key });
        } else {
            findTokens(obj[key], results, path + '.' + key);
        }
    }
}

async function fetchWithToken(token, apiKey) {
    try {
        var url = 'https://www.youtube.com/youtubei/v1/next?key=' + apiKey + '&prettyPrint=false';
        var resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
                'Origin': 'https://www.youtube.com',
                'Referer': 'https://www.youtube.com/',
            },
            body: JSON.stringify({
                context: {
                    client: {
                        clientName: 'WEB',
                        clientVersion: '2.20260401.00.00',
                        hl: 'en',
                        gl: 'US',
                    },
                },
                continuation: token,
            }),
        });

        if (!resp.ok) return [{ _debug: 'API returned ' + resp.status }];
        var data = await resp.json();

        var comments = [];
        var endpoints = data.onResponseReceivedEndpoints || [];

        for (var e = 0; e < endpoints.length; e++) {
            var actions = endpoints[e].reloadContinuationItemsCommand
                || endpoints[e].appendContinuationItemsAction;
            if (!actions) continue;

            var contItems = actions.continuationItems || [];
            for (var c = 0; c < contItems.length; c++) {
                var thread = contItems[c].commentThreadRenderer;
                if (!thread) continue;

                var renderer = thread.comment && thread.comment.commentRenderer;
                if (!renderer) continue;

                var author = (renderer.authorText && renderer.authorText.simpleText) || '';
                var text = '';
                if (renderer.contentText && renderer.contentText.runs) {
                    text = renderer.contentText.runs.map(function(r) { return r.text; }).join('');
                }
                var likes = (renderer.voteCount && renderer.voteCount.simpleText) || '';
                var time = '';
                if (renderer.publishedTimeText && renderer.publishedTimeText.runs) {
                    time = renderer.publishedTimeText.runs.map(function(r) { return r.text; }).join('');
                }

                if (text) {
                    comments.push({ author: author, text: text, likes: likes, time: time });
                }
                if (comments.length >= 20) return comments;
            }
        }

        return comments;
    } catch (e) {
        return [];
    }
}
