// Vercel Serverless Function — YouTube trending music via scraping

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');

    try {
        var artists = await scrapeTrendingMusic();
        return res.status(200).json({ artists: artists });
    } catch (err) {
        console.error('Trending scrape error:', err.message);
        return res.status(500).json({ error: 'Failed to fetch trending', message: err.message });
    }
};

async function scrapeTrendingMusic() {
    var url = 'https://www.youtube.com/feed/trending?bp=4gINGgt5dG1hX2NoYXJ0cw%3D%3D';

    var response = await fetch(url, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        },
    });

    if (!response.ok) {
        throw new Error('YouTube returned ' + response.status);
    }

    var html = await response.text();

    var dataMatch = html.match(/var ytInitialData = ({.*?});<\/script>/s);
    if (!dataMatch) {
        throw new Error('Could not parse YouTube trending page');
    }

    var data = JSON.parse(dataMatch[1]);

    var tabs = (data.contents && data.contents.twoColumnBrowseResultsRenderer && data.contents.twoColumnBrowseResultsRenderer.tabs) || [];
    var seen = {};
    var artists = [];

    for (var t = 0; t < tabs.length; t++) {
        var tabContent = tabs[t].tabRenderer && tabs[t].tabRenderer.content;
        var sections = (tabContent && tabContent.sectionListRenderer && tabContent.sectionListRenderer.contents) || [];

        for (var s = 0; s < sections.length; s++) {
            var sectionItems = (sections[s].itemSectionRenderer && sections[s].itemSectionRenderer.contents) || [];

            for (var i = 0; i < sectionItems.length; i++) {
                var shelf = (sectionItems[i].shelfRenderer && sectionItems[i].shelfRenderer.content && sectionItems[i].shelfRenderer.content.expandedShelfContentsRenderer && sectionItems[i].shelfRenderer.content.expandedShelfContentsRenderer.items) || [sectionItems[i]];

                for (var j = 0; j < shelf.length; j++) {
                    var renderer = shelf[j].videoRenderer;
                    if (!renderer) continue;

                    var channelText = (renderer.ownerText && renderer.ownerText.runs && renderer.ownerText.runs[0] && renderer.ownerText.runs[0].text) || '';
                    var name = channelText
                        .replace(/ - Topic$/i, '')
                        .replace(/VEVO$/i, '')
                        .replace(/Official$/i, '')
                        .trim();

                    if (!name || seen[name.toLowerCase()]) continue;
                    seen[name.toLowerCase()] = true;

                    var videoId = renderer.videoId || '';
                    var thumbs = renderer.thumbnail && renderer.thumbnail.thumbnails;
                    var thumbnail = (thumbs && thumbs.length > 0 && thumbs[thumbs.length - 1].url) || (videoId ? 'https://i.ytimg.com/vi/' + videoId + '/mqdefault.jpg' : '');

                    var titleText = (renderer.title && renderer.title.runs && renderer.title.runs[0] && renderer.title.runs[0].text) || '';

                    artists.push({
                        name: name,
                        thumbnail: thumbnail,
                        videoTitle: titleText,
                    });

                    if (artists.length >= 12) return artists;
                }
            }
        }
    }

    return artists;
}
