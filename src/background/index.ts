// Background script for FASP (Firefox Adaptive Start Page)
// Handles bookmark change listeners and communication

let bookmarkListenerActive = false;

function startBookmarkListener() {
  if (bookmarkListenerActive) return;
  bookmarkListenerActive = true;

  if (typeof browser !== 'undefined' && browser.bookmarks) {
    browser.bookmarks.onCreated.addListener(() => {
      // Notify newtab page of bookmark changes
      browser.runtime.sendMessage({ type: 'bookmarks-changed' }).catch(() => {});
    });

    browser.bookmarks.onRemoved.addListener(() => {
      browser.runtime.sendMessage({ type: 'bookmarks-changed' }).catch(() => {});
    });

    browser.bookmarks.onChanged.addListener(() => {
      browser.runtime.sendMessage({ type: 'bookmarks-changed' }).catch(() => {});
    });

    browser.bookmarks.onMoved.addListener(() => {
      browser.runtime.sendMessage({ type: 'bookmarks-changed' }).catch(() => {});
    });
  }
}

// Listen for messages from the newtab page
if (typeof browser !== 'undefined' && browser.runtime) {
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (!message || typeof message !== 'object' || !('type' in message)) return undefined;
    const typedMessage = message as { type: string; data?: unknown };

    if (typedMessage.type === 'get-bookmarks') {
      return browser.bookmarks.getTree();
    }
    if (typedMessage.type === 'init') {
      startBookmarkListener();
      return Promise.resolve({ status: 'ok' });
    }

    return undefined;
  });
}

// Auto-start listener
startBookmarkListener();

// Export for bundling
export {};
