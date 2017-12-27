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
 * @fileoverview This file implements the content_script logic. The
 * content_script is need for the extension to interact with the DOM tree.
 */

class Content {
  constructor() {
    console.log('constructing content script');
    this.fetchedUrls_ = new Set();
    this.didInit_ = false;
  }

  /**
   * Prefetches a resource.
   *
   * @param {*} msg the message to handle
   */
  handlePrefetchResource(msg) {
    const prefetchMsg = /** @type {Message.Prefetch} */ (msg);
    let link = undefined;
    let url = prefetchMsg.url;
    if (this.fetchedUrls_.has(url)) {
      console.log('already prefetched this URL not prefetching it again.');
      return;
    }
    switch (msg.type) {
      case MessageType.PREFETCH_RESOURCE:
        link = this.constructPrefetchElement(prefetchMsg);
        break;
      case MessageType.PRELOAD_RESOURCE:
        link = this.constructPreloadElement(prefetchMsg);
        break;
      default:
        console.warn('unknown prefetch: ' + JSON.stringify(prefetchMsg));
        return;
    }
    this.fetchedUrls_.add(url);
    console.log('prefetching: ' + link.outerHTML);
    document.getElementsByTagName('head')[0].appendChild(link);
  }

  /**
   * Constructs a <link rel="prefetch"> DOM element.
   *
   * @param {Message.Prefetch} msg the info of the resource.
   *
   * @return {HTMLLinkElement} the HTML link element with rel set to prefetch.
   */
  constructPrefetchElement(msg) {
    const link =
        /** @type {!HTMLLinkElement} */ (document.createElement('link'));
    domSafe.setLinkHrefAndRel(link, msg.url, 'prefetch');
    return link;
  }

  /**
   * Constructs a <link rel="preload"> DOM element.
   *
   * @param {Message.Prefetch} msg the info of the resource.
   *
   * @return {HTMLLinkElement} the HTML link element with rel set to preload.
   */
  constructPreloadElement(msg) {
    const link =
        /** @type {!HTMLLinkElement} */ (document.createElement('link'));
    domSafe.setLinkHrefAndRel(link, msg.url, 'preload');
    link.as = this.getPreloadTypeString(msg.resourceType);
    return link;
  }

  getPreloadTypeString(type) {
    if (type.toLowerCase() === 'stylesheet') {
      return 'style';
    }
    return type.toLowerCase();
  }

  /**
   * Logs the timing to the console.
   *
   * @param {*} msg the message to handle
   */
  handleLogTiming(msg) {
    let logStr = msg.url + ',' + msg.requestId + ',' + msg.fetchTime + ',' +
        msg.requestTimestampMs + ',' + msg.completeTimestampMs;
    if (msg.isPrefetch === 'yes') {
      logStr += ',PREFETCH';
    } else if (msg.isPrefetch === 'no') {
      logStr += ',ACTUAL';
    } else if (msg.isPrefetch === 'late') {
      logStr += ',LATE_PREFETCH';
    } else {
      logStr += ',UNKNOWN';
    }
    console.log(logStr);
  }

  onMessageHandler(msg, sender, sendResponse) {
    console.log('received message: ' + JSON.stringify(msg));
    switch (msg.type) {
      case MessageType.PREFETCH_RESOURCE:
      case MessageType.PRELOAD_RESOURCE:
        this.handlePrefetchResource(msg);
        break;
      case MessageType.LOG_TIMING:
        this.handleLogTiming(msg);
        break;
      case MessageType.NAVIGATED_TO_DST:
        console.log('navigated to destination: ' + msg.url);
        break;
      case MessageType.DEBUG:
        console.log('[DEBUG] ' + JSON.stringify(msg));
        break;
      case MessageType.INFO:
        console.log('received info message at ' + String(performance.now()));
        console.log(
            '[content ' + String(performance.now()) + '] ' + msg.message);
        break;
      default:
        console.warn('undefined message: ' + JSON.stringify(msg));
    }
  }


  start() {
    if (!this.didInit_) {
      console.log('content script ran');
      chrome.runtime.onMessage.removeListener(this.onMessageHandler.bind(this));
      chrome.runtime.onMessage.addListener(this.onMessageHandler.bind(this));

      console.log('Initializing the content script.');
      const /** @type {Message.InitClientScript} */ msg = {
        type: MessageType.CONTENT_SCRIPT_INIT
      };
      chrome.runtime.sendMessage(msg);
      console.log('content_script initialization done.');
    }
    this.didInit_ = true;
  }
}
