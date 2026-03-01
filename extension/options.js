if (typeof browser === "undefined") {
  var browser = chrome;
}

const DEFAULT_USER_SETTINGS = {
  showMetadata: true,
  filterHideWatched: false,
  filterMaxRatio: 0,
};

function saveOptions(e) {
  e.preventDefault();
  browser.storage.sync.set({
    showMetadata: document.querySelector('#show-metadata').checked,
  });
}

function restoreOptions() {
  function setCurrentChoice(result) {
    document.querySelector('#show-metadata').checked =
      result.showMetadata !== undefined
        ? result.showMetadata
        : DEFAULT_USER_SETTINGS.showMetadata;
  }

  function onError(error) {
    console.log(`Error: ${error}`);
  }

  browser.storage.sync.get(DEFAULT_USER_SETTINGS).then(setCurrentChoice, onError);
}

document.addEventListener('DOMContentLoaded', restoreOptions);
document.querySelector('form').addEventListener('submit', saveOptions);
