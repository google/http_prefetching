// Copyright 2017 Google Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview Implements a scheduler in the form of Chrome extension
 * leveraging the webRequest API. It take prefetch hints from the server in the
 * form of HTTP response header with "x-prefetch" as the header key. Hints are
 * parsed and populated into the corresponding priority bucket.
 */

// The number of priorities that can be assigned starting from 0 ...
// (NUM_PRIORITIES - 1).
const NUM_PRIORITIES = 100;

// The number of outstanding requests allowed at a given time.
const OUTSTANDING_REQUESTS_ALLOWED = 7;

// The delimeter to split the prefetch URLS. |$de| contains a combination of
// characters that is unlikely to appear together.
const DELIMETER = '|$de|';

// The max value of the main frame priority. Any resource that has priority
// greater than this number will use <link rel="prefetch"> for prefetching
// instead of <link rel="preload">.
const MAX_MAIN_FRAME_PRIORITY = 2;

/**
 * This scheduler implements a scheduler that takes a numerical priority that
 * was given from the server and request them based on that priority. The lower
 * the number the higher the priority. 0 is the highest priority. All
 * dependencies that have the same priority will be requested in the same order
 * that the server sent the dependencies.
 */
class NumericPriorityScheduler {
  constructor() {
    /**
     * A 2-D array of all the dependencies. The queues with lower priority will
     * be dequeued first.
     * @private {!Array<!Array<!PrefetchResource>>}
     */
    this.dependencies_ = new Array(NUM_PRIORITIES);
    for (let i = 0; i < NUM_PRIORITIES; i++) {
      this.dependencies_[i] = new Array();
    }

    /**
     * A set containing URLs (or request id) of requests that are in-flight.
     * @private {!Set<!string>}
     */
    this.outstandingPrefetchUrls_ = new Set();

    this.timeTracker = new TimeTracker.TimeTracker();

    /**
     * Tracks the URLs that are already requested to prevent duplicated requests
     * in the case where prefetch request goes out after the actual request.
     * @private {!Set<!string>}
     */
    this.requestedURLs_ = new Set();

    /**
     * The landing page URL that this experiment will navigate to. This is used
     * to detect when the navigation to the landing page has already started.
     */
    this.lpUrl = '';

    /**
     * Flag indicating whether the browser has already navigated to the landing
     * page. The browser has navigated when the request header for lpUrl is
     * sent.
     *
     * @private {!boolean}
     */
    this.navigatedToDst_ = false;

    /**
     * Array containing URLs that are waiting to be fetched for a particular
     * priority.
     *
     * @private {!Array<!PrefetchResource>}
     */
    this.queuedPrefetches_ = new Array();

    /**
     * Indicates which priority level that the scheduler is requesting right
     * now.
     *
     * @private {number}
     */
    this.curFetchPriority_ = -1;

    this.didInit_ = false;

    this.initializedContentScript_ = false;
  }

  /**
   * Handles the event before the headers are sent for the request.
   *
   * @param {!Object} details Details about the request.
   * @private
   */
  onSendHeaders_(details) {
    console.log('send headers:');
    console.log(details);

    const isPrefetch = this.isPrefetchRequest_(details.requestHeaders);

    // TODO(vaspol): track the whether the prefetch request is received before
    // the resource is discovered from the browser.
    this.timeTracker.registerRequest(
        details.requestId, details.timeStamp, isPrefetch);
    console.log(this.timeTracker);

    // Browser is navigating to the landing page.
    if (details.url === this.lpUrl) {
      const /** @type {Message.NavigatedToDst} */ msg = {
        type: MessageType.NAVIGATED_TO_DST,
        url: this.lpUrl
      };
      this.notifyContentScript_(msg);

      // In a re-using a browser for multiple experiments, this has to be switch
      // back to false. However, for this current setup with WPT, it is okay to
      // leave it as is.
      this.navigatedToDst_ = true;
    }

    // Keep track of the URLs that are already requested so that we don't
    // send out a prefetch request for that URL again.
    this.requestedURLs_.add(details.url);
  }

  /**
   * Determines from the requestHeaders whether this request is a prefetch
   * request or not.
   *
   * @param {Array<!Object>} requestHeaders the headers of the request to be
   * determined.
   *
   * @return {boolean} whether the request is a prefetch request or not based on the
   * requestHeader
   * @private
   */
  isPrefetchRequest_(requestHeaders) {
    for (let i = 0; i < requestHeaders.length; i++) {
      const element = requestHeaders[i];
      if (element.name.toLowerCase() === 'purpose' &&
          element.value.toLowerCase() === 'prefetch') {
        return true;
      }
    }
    return false;
  }

  /**
   * onHeadersReceived_ implements the logic when the response header is
   * received from the server. It parses the response headers and extracts the
   * dependency hints along with its priority.
   *
   * @param {!Object} details Details about the request. See:
   * https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/webRequest/onHeadersReceived#details
   *
   * @return {!Object} a object containing the request headers
   * @private
   */
  onHeadersReceived_(details) {
    const /** @type {Message.Info} */ completeMsg = {
      type: MessageType.INFO,
      message: performance.now() + ' HeadersReceived: ' + details.url +
          ' headers: ' + details.responseHeaders
    };
    this.notifyContentScript_(completeMsg);
    details.responseHeaders.forEach((element) => {
      if (element.name.toLowerCase() === 'x-prefetch') {
        // Prefetch URLs are in the same format as Preload HTTP headers.
        this.parsePrefetchURLs(this.dependencies_, element.value);
      } else if (element.name.toLowerCase() === 'x-lp-url') {
        this.lpUrl = element.value;
      }
    });
    return {requestHeaders: details.responseHeaders};
  }

  /**
   * parsePrefetchURLs parses the hinted x-prefetch string and populate the
   * dependencies with the appropriate URLs into the correct priority bucket.
   */
  parsePrefetchURLs(dependencies, prefetchStr) {
    const prefetchURLs = prefetchStr.split(DELIMETER);
    prefetchURLs.forEach((element) => {
      const prefetchInfo = element.split(';');

      // Parse the URL.
      const trimmedUrl = prefetchInfo[0].trim();
      const url =
          trimmedUrl.substring(1, trimmedUrl.length - 1);  // Remove < and >

      // Parse the priority.
      const priority = parseInt(prefetchInfo[1].split('=')[1].trim(), 10);
      const targetPriority = Math.min(priority, NUM_PRIORITIES - 1);

      // Parse the type.
      const type = prefetchInfo[2].split('=')[1].trim();
      const prefetchResource = new PrefetchResource(url, type);
      dependencies[targetPriority].push(prefetchResource);
    });
  }

  /**
   * handleFetchCompleted implements the logic handling when all requests have
   * been received at a priority level. This function fetches resources from
   * the next priority tier.
   */
  handleFetchCompleted(fetchedURL) {
    const /** @type {Message.Info} */ calledMsg = {
      'type': MessageType.INFO,
      'message': performance.now() +
          ' calling handleFetchCompleted() after fetch: ' + fetchedURL
    };
    this.notifyContentScript_(calledMsg);
    // Start prefetching more when we don't have any outstanding fetches.
    if (this.outstandingPrefetchUrls_.size >= OUTSTANDING_REQUESTS_ALLOWED) {
      return;
    }

    // Find the first non-empty dependency in the priorities. Queue them up
    // for fetching. Do this only when the queue for prefetching is empty.
    let nextPriority = -1;
    for (let i = 0; i < this.dependencies_.length; i++) {
      if (this.dependencies_[i].length > 0) {
        nextPriority = i;
        break;
      }
    }

    if (this.outstandingPrefetchUrls_.size == 0 && nextPriority != -1 &&
        this.queuedPrefetches_.length == 0) {
      // Enqueue more URLs to prefetch when there isn't any outstanding
      // prefetches, the prefetch queue is empty, and there are more
      // URLs left to prefetch.
      const dependencies = this.dependencies_[nextPriority];
      while (dependencies.length > 0) {
        const dependency =
            dependencies.splice(0, 1)[0];  // Remove the first dependency.
        this.queuedPrefetches_.push(dependency);
      }
      this.curFetchPriority_ = nextPriority;
    }

    const /** @type {Message.Info} */ msg = {
      'type': MessageType.INFO,
      'message': performance.now() + ' len(outstanding_prefetches): ' +
          this.outstandingPrefetchUrls_.size + ' len(queuedPrefetches): ' +
          this.queuedPrefetches_.length + ' ' + String(this.queuedPrefetches_)
    };
    this.notifyContentScript_(msg);

    // Fetch the dependency from the queued ones only.
    while (this.outstandingPrefetchUrls_.size < OUTSTANDING_REQUESTS_ALLOWED &&
           this.queuedPrefetches_.length > 0) {
      // Get the next dependency to fetch.
      const dependency = this.queuedPrefetches_.splice(0, 1)[0];
      this.fetchDependency(dependency, this.curFetchPriority_);
    }
  }

  /**
   * Implements fetching of a dependency using <link rel="prefetch">.
   *
   * @param {PrefetchResource} resource the resource to be prefetched.
   * @param {number} priority the number representing the priority of the
   * resource.
   */
  fetchDependency(resource, priority) {
    // If this url has already been requested, don't prefetch it again.
    const url = resource.url;
    if (this.requestedURLs_.has(url)) {
      console.log(
          'URL: ' + url +
          ' has already been requested by the browser NOT PREFETCHING');
      const /** @type {Message.Log} */ msg = {
        type: MessageType.LOG_TIMING,
        url: url,
        requestId: '',
        fetchTime: -1,
        requestTimestampMs: -1,
        completeTimestampMs: -1,
        isPrefetch: 'late'
      };
      this.notifyContentScript_(msg);
      return;
    }

    // Notify content script prefetch url.
    let msgType = this.navigatedToDst_ ? MessageType.PRELOAD_RESOURCE :
                                         MessageType.PREFETCH_RESOURCE;

    // Not part of the main frame, fetch it with <link rel="prefetch">
    if (priority > MAX_MAIN_FRAME_PRIORITY) {
      msgType = MessageType.PREFETCH_RESOURCE;
    }
    const /** @type {Message.Prefetch} */ msg = {
      type: msgType,
      url: resource.url,
      resourceType: resource.type
    };
    this.notifyContentScript_(msg);
    this.outstandingPrefetchUrls_.add(url);
  }

  /**
   * Implements the logic to handle messages from the content script.
   *
   * @private
   */
  onContentMessage_(msg, sender, sendResponse) {
    switch (msg.type) {
      case MessageType.CONTENT_SCRIPT_INIT:
        if (!this.initializedContentScript_) {
          this.handleFetchCompleted('INIT');
          this.initializedContentScript_ = true;
        }
        break;
      case MessageType.COMPLETED:
        break;
      default:
        console.warn('received an undefined message of type ' + msg.type);
    }
  }

  onErrorOccurred_(details) {
    const /** @type {Message.Info} */ completeMsg = {
      type: MessageType.INFO,
      message: performance.now() + 'Error: ' + details.url
    };
    this.notifyContentScript_(completeMsg);
    this.onFetchCompleted_(details);
  }

  onFetchSucceed_(details) {
    const /** @type {Message.Info} */ completeMsg = {
      type: MessageType.INFO,
      message: performance.now() + ' Completed: ' + details.url +
          ' len(outstanding): ' + this.outstandingPrefetchUrls_.size +
          ' outstanding: ' + String(Array.from(this.outstandingPrefetchUrls_)) +
          ' details: ' + JSON.stringify(details)
    };
    this.notifyContentScript_(completeMsg);
    this.onFetchCompleted_(details);
  }

  /**
   * Implements the logic when a fetch of a resource has been completed
   * regardless of whether it succeeded or not.
   *
   * @private
   */
  onFetchCompleted_(details) {
    this.outstandingPrefetchUrls_.delete(details.url);
    this.handleFetchCompleted(details.url);
    const /** @type {Message.Debug} */ debugMsg = {
      type: MessageType.DEBUG,
      data: JSON.stringify(this.timeTracker)

    };
    this.notifyContentScript_(debugMsg);
    console.log(details);
    console.log(
        'fetch completed for ' + details.url +
        ' requestId: ' + details.requestId);
    console.log(this.timeTracker);
    const fetchTime =
        this.timeTracker.completeRequest(details.requestId, details.timeStamp);
    console.log('fetchTime: ' + fetchTime);
    const /** @type {Message.Log} */ logMsg = {
      type: MessageType.LOG_TIMING,
      url: details.url,
      requestId: details.requestId,
      fetchTime: fetchTime,
      requestTimestampMs: this.timeTracker.getRequestTime(details.requestId),
      completeTimestampMs: this.timeTracker.getCompleteTime(details.requestId),
      isPrefetch: this.timeTracker.isPrefetchRequest(details.requestId)
    };
    console.log('sending log message: ' + JSON.stringify(logMsg));
    this.notifyContentScript_(logMsg);
  }

  /**
   * Helper method for sending a message to the content script.
   *
   * @param {*} msg the message to be sent.
   *
   * @private
   */
  notifyContentScript_(msg) {
    // Get the current active tab and send the message to it.
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, msg);
    });
  }

  run() {
    if (!this.didInit_) {
      const /** @type {Message.Info} */ completeMsg = {
        type: MessageType.INFO,
        message: performance.now() + ' starting background script'
      };
      this.notifyContentScript_(completeMsg);
      const /** @type {!Array.<!string>} */ requestExtraInfoSpec =
          ['requestHeaders'];
      const /** @type {!Array.<!string>} */ responseExtraInfoSpec =
          ['responseHeaders'];
      const /** @type {!RequestFilter} */ filters = {
        urls: ['<all_urls>'],
      };

      // Add the event listeners.
      chrome.webRequest.onSendHeaders.addListener(
          this.onSendHeaders_.bind(this), filters, requestExtraInfoSpec);
      chrome.webRequest.onHeadersReceived.addListener(
          this.onHeadersReceived_.bind(this), filters, responseExtraInfoSpec);
      chrome.webRequest.onCompleted.addListener(
          this.onFetchSucceed_.bind(this), filters, responseExtraInfoSpec);
      chrome.webRequest.onErrorOccurred.addListener(
          this.onErrorOccurred_.bind(this), filters);
      chrome.runtime.onMessage.addListener(this.onContentMessage_.bind(this));

      this.didInit_ = true;
      console.log('scheduler inited');
    }
  }
}
