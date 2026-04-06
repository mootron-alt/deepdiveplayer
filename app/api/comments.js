// Fetch YouTube comments via innertube API

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
    // Step 1: Get the page and extract session data
    var pageRes = await fetch('https://www.youtube.com/watch?v=' + videoId, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });
    if (!pageRes.ok) throw new Error('Page fetch failed');
    var html = await pageRes.text();

    // Extract API key and client version from the page
    var apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    var versionMatch = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/);
    var visitorMatch = html.match(/"VISITOR_DATA":"([^"]+)"/);

    var apiKey = apiKeyMatch ? apiKeyMatch[1] : 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
    var clientVersion = versionMatch ? versionMatch[1] : '2.20260401.00.00';
    var visitorData = visitorMatch ? visitorMatch[1] : '';

    // Extract continuation token for comments
    var dataMatch = html.match(/var ytInitialData = ({.*?});<\/script>/s);
    if (!dataMatch) throw new Error('No data found');
    var data = JSON.parse(dataMatch[1]);

    // Find the comment section continuation
    var token = findCommentToken(data);
    if (!token) return [];

    // Step 2: Fetch comments with the real session data
    var headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'X-Youtube-Client-Name': '1',
        'X-Youtube-Client-Version': clientVersion,
    };

    // Forward cookies from page fetch
    var setCookies = pageRes.headers.get('set-cookie');
    if (setCookies) {
        var cookieStr = setCookies.split(',').map(function(c) {
            return c.split(';')[0].trim();
        }).join('; ');
        headers['Cookie'] = cookieStr;
    }

    if (visitorData) {
        headers['X-Goog-Visitor-Id'] = visitorData;
    }

    var resp = await fetch('https://www.youtube.com/youtubei/v1/next?key=' + apiKey, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
            context: {
                client: {
                    clientName: 'WEB',
                    clientVersion: clientVersion,
                    hl: 'en',
                    gl: 'US',
                    visitorData: visitorData,
                },
            },
            continuation: token,
        }),
    });

    if (!resp.ok) return [];

    var respData = await resp.json();
    return parseComments(respData);
}

function findCommentToken(data) {
    // Look in the main content area for the comments continuation
    var results = data.contents && data.contents.twoColumnWatchNextResults;
    if (results && results.results && results.results.results) {
        var contents = results.results.results.contents || [];
        for (var i = 0; i < contents.length; i++) {
            var section = contents[i].itemSectionRenderer;
            if (!section) continue;
            var items = section.contents || [];
            for (var j = 0; j < items.length; j++) {
                var contRenderer = items[j].continuationItemRenderer;
                if (contRenderer && contRenderer.continuationEndpoint) {
                    var cmd = contRenderer.continuationEndpoint.continuationCommand;
                    if (cmd && cmd.token) return cmd.token;
                }
            }
        }
    }

    // Also check engagement panels
    var panels = data.engagementPanels || [];
    for (var p = 0; p < panels.length; p++) {
        var panel = panels[p].engagementPanelSectionListRenderer;
        if (!panel || !panel.content) continue;
        var sectionList = panel.content.sectionListRenderer;
        if (!sectionList) continue;
        var sContents = sectionList.contents || [];
        for (var s = 0; s < sContents.length; s++) {
            var itemSection = sContents[s].itemSectionRenderer;
            if (!itemSection) continue;
            var sItems = itemSection.contents || [];
            for (var k = 0; k < sItems.length; k++) {
                var cr = sItems[k].continuationItemRenderer;
                if (cr && cr.continuationEndpoint && cr.continuationEndpoint.continuationCommand) {
                    return cr.continuationEndpoint.continuationCommand.token;
                }
            }
        }
    }

    return null;
}

function parseComments(data) {
    var comments = [];

    // Navigate the response
    var endpoints = data.onResponseReceivedEndpoints || [];
    for (var e = 0; e < endpoints.length; e++) {
        var actions = endpoints[e].reloadContinuationItemsCommand
            || endpoints[e].appendContinuationItemsAction;
        if (!actions) continue;

        var items = actions.continuationItems || [];
        for (var i = 0; i < items.length; i++) {
            var thread = items[i].commentThreadRenderer;
            if (!thread) continue;

            var r = thread.comment && thread.comment.commentRenderer;
            if (!r) continue;

            var author = (r.authorText && r.authorText.simpleText) || '';
            var text = '';
            if (r.contentText && r.contentText.runs) {
                text = r.contentText.runs.map(function(run) { return run.text; }).join('');
            }
            var likes = (r.voteCount && r.voteCount.simpleText) || '';
            var time = '';
            if (r.publishedTimeText && r.publishedTimeText.runs) {
                time = r.publishedTimeText.runs.map(function(run) { return run.text; }).join('');
            }

            if (text) {
                comments.push({ author: author, text: text, likes: likes, time: time });
            }
            if (comments.length >= 20) return comments;
        }
    }

    return comments;
}
