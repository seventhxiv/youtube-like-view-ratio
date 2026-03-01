if (typeof browser === "undefined") {
  var browser = chrome;
}

let cache = {};
let cacheTimes = [];
let cacheDuration = 600000;



browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.query) {
    case 'videoApiRequest':
      const now = Date.now();
      let numRemoved = 0;
      for (const [fetchTime, videoId] of cacheTimes) {
        if (now - fetchTime > cacheDuration) {
          delete cache[videoId];
          numRemoved++;
        } else {
          break;
        }
      }
      if (numRemoved > 0) {
        cacheTimes = cacheTimes.slice(numRemoved);
      }

      if (message.videoId in cache) {
        sendResponse(cache[message.videoId]);
        return true; // Keep message channel open
      }

      fetch(
        'https://returnyoutubedislikeapi.com/Votes?videoId=' + message.videoId,
      ).then((response) => {
        if (!response.ok) {
          sendResponse(null);
        } else {
          response.json().then((data) => {
            const likesData = {
              likes: data.likes,
              dislikes: data.dislikes,
              viewCount: data.viewCount,
            };
            if (!(message.videoId in cache)) {
              cache[message.videoId] = likesData;
              cacheTimes.push([Date.now(), message.videoId]);
            }
            sendResponse(likesData);
          }).catch(() => sendResponse(null));
        }
      }).catch(() => sendResponse(null));

      return true; // Keep message channel open for async response


  }
});
