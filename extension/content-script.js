if (typeof browser === "undefined") {
  var browser = chrome;
}

const HANDLE_DOM_MUTATIONS_THROTTLE_MS = 100;
let domMutationsAreThrottled = false;
let hasUnseenDomMutations = false;

const API_RETRY_DELAY = 5000;
const MAX_RETRIES_PER_THUMBNAIL = 10;
let isPendingApiRetry = false;
let thumbnailsToRetry = [];

let curTheme = 0;
const THEME_MODERN = 1;
const THEME_CLASSIC = 2;
const THEME_GAMING = 3;
const THEME_MOBILE = 4;
const NUM_THEMES = 4;

const ADD_RATING_BAR_TO_SHORTS = false;

const isDarkTheme = getComputedStyle(document.body).getPropertyValue('--yt-spec-general-background-a') === ' #181818';

const THUMBNAIL_SELECTORS = [];
THUMBNAIL_SELECTORS[THEME_MODERN] = 'a#thumbnail[href]';
THUMBNAIL_SELECTORS[THEME_CLASSIC] = '.video-thumb:not(.yt-thumb-20):not(.yt-thumb-27):not(.yt-thumb-32):not(.yt-thumb-36):not(.yt-thumb-48):not(.yt-thumb-64), .thumb-wrapper, .pl-header-thumb';
THUMBNAIL_SELECTORS[THEME_GAMING] = 'ytg-thumbnail:not([avatar]):not(.avatar):not(.ytg-user-avatar):not(.ytg-box-art):not(.ytg-compact-gaming-event-renderer):not(.ytg-playlist-header-renderer)';
THUMBNAIL_SELECTORS[THEME_MOBILE] = 'a.media-item-thumbnail-container, a.compact-media-item-image, a.video-card-image';

const THUMBNAIL_SELECTOR_VIDEOWALL = 'a.ytp-videowall-still';

const DEFAULT_USER_SETTINGS = {
  showMetadata: true,
  filterHideWatched: false,
  filterMinScore: 0,
};
let userSettings = DEFAULT_USER_SETTINGS;

let lastUrl = location.href;

function injectFilterMenu() {
  if (!window.location.href.includes('/videos') && !window.location.href.includes('/shorts') && !window.location.href.includes('/streams')) {
    $('#ytrb-filter-menu').remove();
    return;
  }

  if (lastUrl !== location.href) {
    lastUrl = location.href;
    userSettings.filterMinScore = 0;
    $('#ytrb-min-score').val('');
    applyFilters();
  }

  const chipBar = $('ytd-feed-filter-chip-bar-renderer').first();
  const grid = $('ytd-rich-grid-renderer').first();
  const target = chipBar.length ? chipBar : grid;

  if (target.length && !$('#ytrb-filter-menu').length) {
    userSettings.filterMinScore = 0;

    const menuHtml = `
      <div id="ytrb-filter-menu" style="display: flex; gap: 15px; padding: 0 10px; align-items: center; color: var(--yt-spec-text-primary); margin-left: auto;">
        <label style="display: flex; align-items: center; cursor: pointer; white-space: nowrap;">
          <input type="checkbox" id="ytrb-hide-watched" ${userSettings.filterHideWatched ? 'checked' : ''} style="margin-right: 8px;">
          Hide Watched
        </label>
        <label style="display: flex; align-items: center; cursor: pointer; white-space: nowrap;">
          Min Likes/1k:
          <input type="number" id="ytrb-min-score" value="" placeholder="No limit" style="margin-left: 8px; padding: 4px; border-radius: 4px; border: 1px solid var(--yt-spec-10-percent-layer); background: transparent; color: inherit; width: 70px;">
        </label>
      </div>
    `;

    if (chipBar.length) {
      target.css({
        'display': 'flex',
        'align-items': 'center',
        'flex-direction': 'row'
      });
      target.append(menuHtml);
    } else {
      grid.before(menuHtml);
      $('#ytrb-filter-menu').css('margin-bottom', '10px');
    }

    $('#ytrb-hide-watched').on('change', function () {
      userSettings.filterHideWatched = this.checked;
      applyFilters();
    });

    $('#ytrb-min-score').on('input', function () {
      const val = parseFloat(this.value) || 0;
      userSettings.filterMinScore = val;
      applyFilters();
    });
  }
}

function applyFilters() {
  if (!window.location.href.includes('/videos') && !window.location.href.includes('/shorts') && !window.location.href.includes('/streams')) {
    return;
  }

  $('ytd-rich-item-renderer').each(function () {
    const container = $(this);
    const thumbnail = container.find(THUMBNAIL_SELECTORS[curTheme] || 'a#thumbnail');

    if (!thumbnail.length) return;

    let shouldHide = false;

    if (userSettings.filterHideWatched) {
      const watchPercentage = getWatchPercentage(thumbnail);
      if (watchPercentage > 90) {
        shouldHide = true;
      }
    }

    if (!shouldHide && userSettings.filterMinScore > 0) {
      const score = parseFloat(thumbnail.attr('data-ytrb-score'));
      if (!isNaN(score) && score < userSettings.filterMinScore) {
        shouldHide = true;
      }
    }

    if (shouldHide) {
      container.hide();
    } else {
      container.show();
    }
  });
}

function ratingToPercentage(rating) {
  if (rating === 1) {
    return (100).toLocaleString() + '%';
  }
  return (
    (Math.floor(rating * 1000) / 10).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + '%'
  );
}

function getMetadataHtml(videoData, likesPer1k, isWatched) {
  let scoreHtml = '';
  if (likesPer1k !== null) {
    scoreHtml = ' <span style="margin: 0 4px; color: var(--yt-spec-text-secondary);">•</span> <span class="ytrb-score">' + Math.round(likesPer1k).toLocaleString() + '</span>';
  }

  let watchedHtml = '';
  if (isWatched) {
    watchedHtml = ' <span style="color: #4CAF50; margin-left: 4px;" title="Watched">✓</span>';
  }

  return (
    '<span class="style-scope ytd-video-meta-block ytd-grid-video-renderer ytrb-percentage">' +
    '<span style="color: var(--yt-spec-text-secondary);">' + ratingToPercentage(videoData.rating) + '</span>' +
    scoreHtml +
    watchedHtml +
    '</span>'
  );
}

function getNewThumbnails() {
  let thumbnails = [];
  if (curTheme) {
    thumbnails = $(THUMBNAIL_SELECTORS[curTheme]);
  } else {
    for (let i = 1; i <= NUM_THEMES; i++) {
      thumbnails = $(THUMBNAIL_SELECTORS[i]);
      if (thumbnails.length) {
        curTheme = i;
        break;
      }
    }
  }
  thumbnails = $.merge(thumbnails, $(THUMBNAIL_SELECTOR_VIDEOWALL));
  return thumbnails;
}

function getThumbnailsAndIds(thumbnails) {
  const thumbnailsAndVideoIds = [];
  $(thumbnails).each(function (_, thumbnail) {
    let url;
    if (curTheme === THEME_MODERN) {
      url = $(thumbnail).attr('href');
    } else if (curTheme === THEME_CLASSIC) {
      url =
        $(thumbnail).attr('href') ||
        $(thumbnail).parent().attr('href') ||
        $(thumbnail).parent().parent().attr('href') ||
        $(thumbnail).children(':first').attr('href') ||
        $(thumbnail).children(':first').next().attr('href');
    } else if (curTheme === THEME_GAMING) {
      url =
        $(thumbnail).attr('href') ||
        $(thumbnail).parent().parent().attr('href') ||
        $(thumbnail).parent().parent().parent().attr('href');

      if (!$(thumbnail).is('a')) {
        thumbnail = $(thumbnail).parent();
      }
    } else if (curTheme === THEME_MOBILE) {
      url = $(thumbnail).attr('href');
      const firstChild = $(thumbnail).children(':first')[0];
      if ($(firstChild).is('.video-thumbnail-container-compact')) {
        thumbnail = firstChild;
      }
    } else {
      url = $(thumbnail).attr('href');
    }

    if (!url) {
      return true;
    }

    const previousUrl = $(thumbnail).attr('data-ytrb-url');
    if (previousUrl) {
      if (previousUrl === url) {
        if (curTheme === THEME_MOBILE) {
          if ($(thumbnail).children().last().is('ytrb-bar')) {
            return true;
          }
        } else {
          return true;
        }
      } else {
        $(thumbnail).children('ytrb-bar').remove();
        $(thumbnail).removeAttr('data-ytrb-retries');
      }
    }

    $(thumbnail).attr('data-ytrb-url', url);

    const match =
      url.match(/.*[?&]v=([^&]+).*/) ||
      (ADD_RATING_BAR_TO_SHORTS && url.match(/^\/shorts\/(.+)$/));
    if (match) {
      const id = match[1];
      thumbnailsAndVideoIds.push([thumbnail, id]);
    }
  });
  return thumbnailsAndVideoIds;
}

function getVideoDataObject(likes, dislikes, viewCount) {
  const total = likes + dislikes;
  const rating = total ? likes / total : null;
  return {
    likes: likes,
    dislikes: dislikes,
    total: total,
    rating: rating,
    viewCount: viewCount,
  };
}

function retryProcessingThumbnailInTheFuture(thumbnail) {
  thumbnailsToRetry.push(thumbnail);
  if (!isPendingApiRetry) {
    isPendingApiRetry = true;
    setTimeout(() => {
      isPendingApiRetry = false;
      thumbnailsToRetry.forEach((thumbnail) => {
        const retriesAttr = $(thumbnail).attr('data-ytrb-retries');
        const retriesNum = retriesAttr ? Number.parseInt(retriesAttr, 10) : 0;
        if (retriesNum < MAX_RETRIES_PER_THUMBNAIL) {
          $(thumbnail).attr('data-ytrb-retries', retriesNum + 1);
          $(thumbnail).removeAttr('data-ytrb-url');
          hasUnseenDomMutations = true;
        }
      });
      thumbnailsToRetry = [];
      handleDomMutations();
    }, API_RETRY_DELAY);
  }
}

function getVideoData(thumbnail, videoId) {
  return new Promise((resolve) => {
    browser.runtime.sendMessage({ query: 'videoApiRequest', videoId: videoId }, (likesData) => {
      // Check for lastError to handle disconnected ports or other messaging errors
      if (browser.runtime.lastError || !likesData) {
        retryProcessingThumbnailInTheFuture(thumbnail);
        resolve(null);
      } else {
        resolve(getVideoDataObject(likesData.likes, likesData.dislikes, likesData.viewCount));
      }
    });
  });
}

function getWatchPercentage(thumbnail) {
  const progressBar = $(thumbnail).find('ytd-thumbnail-overlay-resume-playback-renderer #progress');
  if (progressBar.length) {
    const width = progressBar[0].style.width;
    if (width && width.endsWith('%')) {
      return parseFloat(width);
    }
  }
  return 0;
}

function addVideoMetadata(thumbnail, videoData) {
  let metadataLine;
  if (curTheme === THEME_MOBILE) {
    metadataLine = $(thumbnail)
      .closest('ytm-media-item')
      .find('ytm-badge-and-byline-renderer')
      .last();
  } else {
    metadataLine = $(thumbnail)
      .closest(
        '.ytd-rich-item-renderer, ' +
        '.ytd-grid-renderer, ' +
        '.ytd-expanded-shelf-contents-renderer, ' +
        '.yt-horizontal-list-renderer, ' +
        '.ytd-item-section-renderer, ' +
        '.ytd-horizontal-card-list-renderer, ' +
        '.ytd-playlist-video-list-renderer',
      )
      .find('#metadata-line')
      .last();
  }

  if (metadataLine) {
    for (const oldPercentage of metadataLine.children('.ytrb-percentage')) {
      oldPercentage.remove();
    }
    if (curTheme === THEME_MOBILE) {
      for (const oldPercentage of metadataLine.children(
        '.ytrb-percentage-separator',
      )) {
        oldPercentage.remove();
      }
    }

    if (
      videoData.rating != null &&
      !(videoData.likes === 0 && videoData.dislikes >= 10)
    ) {
      let likesPer1k = null;
      if (videoData.viewCount && videoData.viewCount > 0) {
        likesPer1k = (videoData.likes / videoData.viewCount) * 1000;
        $(thumbnail).attr('data-ytrb-score', likesPer1k);
      }

      const watchPercentage = getWatchPercentage(thumbnail);
      const isWatched = watchPercentage > 90;
      const metadataHtml = getMetadataHtml(videoData, likesPer1k, isWatched);
      const lastSpan = metadataLine.children('span').last();
      if (lastSpan.length) {
        lastSpan.after(metadataHtml);
        if (curTheme === THEME_MOBILE) {
          lastSpan.after(
            '<span class="ytm-badge-and-byline-separator ytrb-percentage-separator" aria-hidden="true">•</span>',
          );
        }
      } else {
        metadataLine.prepend(metadataHtml);
        metadataLine.prepend(
          '<span class="style-scope ytd-video-meta-block"></span>',
        );
      }
    }
  }
}

function updateColors() {
  const scores = [];
  const items = [];

  $(THUMBNAIL_SELECTORS[curTheme] || 'a#thumbnail').each(function () {
    const thumbnail = $(this);
    const score = parseFloat(thumbnail.attr('data-ytrb-score'));
    if (!isNaN(score)) {
      scores.push(score);
      items.push({ thumbnail, score });
    }
  });

  if (scores.length === 0) return;

  const sum = scores.reduce((a, b) => a + b, 0);
  const avg = sum / scores.length;

  items.forEach(({ thumbnail, score }) => {
    const container = thumbnail.closest('ytd-rich-item-renderer, ytd-grid-video-renderer, ytm-media-item');
    const scoreSpan = container.find('.ytrb-score');

    if (scoreSpan.length) {
      let bgColor = '#606060'; // Default (Average) - Dark Grey
      let textColor = 'white';

      if (score >= avg * 1.2) {
        bgColor = '#4CAF50'; // Green
        textColor = 'white';
      } else if (score <= avg * 0.8) {
        bgColor = '#FF5252'; // Red
        textColor = 'white';
      } else {
        bgColor = 'rgba(255, 255, 255, 0.1)';
        textColor = 'var(--yt-spec-text-primary)';
      }

      scoreSpan.css({
        'background-color': bgColor,
        'color': textColor,
        'padding': '2px 6px',
        'border-radius': '4px',
        'font-weight': '500',
        'margin-left': '4px'
      });
    }
  });
}

function processNewThumbnails() {
  const thumbnails = getNewThumbnails();
  const thumbnailsAndVideoIds = getThumbnailsAndIds(thumbnails);

  const promises = [];
  for (const [thumbnail, videoId] of thumbnailsAndVideoIds) {
    const p = getVideoData(thumbnail, videoId).then((videoData) => {
      if (videoData !== null) {
        if (userSettings.showMetadata) {
          addVideoMetadata(thumbnail, videoData);
        }
      }
    });
    promises.push(p);
  }

  Promise.all(promises).then(() => {
    updateColors();
    applyFilters();
  });

  injectFilterMenu();
}

function handleDomMutations() {
  if (domMutationsAreThrottled) {
    hasUnseenDomMutations = true;
  } else {
    domMutationsAreThrottled = true;

    if (userSettings.showMetadata) {
      processNewThumbnails();
    }

    hasUnseenDomMutations = false;

    setTimeout(function () {
      domMutationsAreThrottled = false;
      if (hasUnseenDomMutations) {
        handleDomMutations();
      }
    }, HANDLE_DOM_MUTATIONS_THROTTLE_MS);
  }
}

const mutationObserver = new MutationObserver(handleDomMutations);

browser.storage.sync.get(DEFAULT_USER_SETTINGS).then((storedSettings) => {
  if (storedSettings) {
    userSettings = storedSettings;
  }

  handleDomMutations();
  mutationObserver.observe(document.body, { childList: true, subtree: true });
});
