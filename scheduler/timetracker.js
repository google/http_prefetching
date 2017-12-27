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
 * @fileoverview Implements the logic for tracking the request and finish time
 * of an object.
 */
const PrefetchStatus = {
  YES: 'yes',
  NO: 'no',
  UNKNOWN: 'unknown'
};

class TimeTracker {
  constructor() {
    /**
     * Maps from the request ID to the time the request was made measured in
     * milliseconds.
     *
     * @private Map<!string, number>
     */
    this.requestTimes_ = new Map();

    /**
     * Maps from the request ID to the timestamp when the request finished.
     * @private Map<!string, number>
     */
    this.completeTimes_ = new Map();

    /**
     * Maps from the request ID to whether the request is a prefetch request or
     * not.
     * @private Map<!string, boolean>
     */
    this.prefetched_ = new Map();
  }

  /**
   * Registers a request, using the provided requestID, to the
   * requestTimestampMS in the time tracker.
   *
   * @param {string} requestID the request ID of the request
   * @param {number} requestTimestampMs the timestamp when the request was
   * made.
   * @param {boolean} isPrefetch whether this request is a prefetch request or
   * not.
   * @public
   */
  registerRequest(requestID, requestTimestampMs, isPrefetch) {
    this.requestTimes_.set(requestID, requestTimestampMs);

    // -1 indicates that this request is still not complete.
    this.completeTimes_.set(requestID, -1);
    this.prefetched_.set(requestID, isPrefetch);
  }

  /**
   * Completes a request, using the provided requestID, to the
   * requestTimestampMS in the time tracker.
   *
   * @param {string} requestID the request ID of the request
   * @param {number} completeTimestampMs the timestamp when the request was
   * made.
   *
   * @return {number} The fetch time of the request ID. If the requestID has
   * never been seen before, the function returns -1.
   */
  completeRequest(requestID, completeTimestampMs) {
    console.log(
        'completing request for ' + requestID + ' at ' + completeTimestampMs);
    if (!this.requestTimes_.has(requestID)) {
      return -1;
    }

    const requestTime = this.requestTimes_.get(requestID);
    const fetchTime = completeTimestampMs - requestTime;
    this.completeTimes_.set(requestID, completeTimestampMs);
    return fetchTime;
  }

  /**
   * Returns whether the request was a prefetch request or not.
   *
   * @param {string} requestID the request ID to check.
   *
   * @return {string} whether the request was a prefetch request or not
   */
  isPrefetchRequest(requestID) {
    console.log('querying isPrefetchRequest for ' + requestID);
    if (!this.requestTimes_.has(requestID)) {
      return PrefetchStatus.UNKNOWN;
    }
    return this.prefetched_.get(requestID) ? PrefetchStatus.YES :
                                             PrefetchStatus.NO;
  }

  /**
   * Returns the timestamp when the request was made.
   *
   * @param {string} requestID the id of the request.
   *
   * @return {number} the timestamp when the request was made. -1, if the
   * request was not tracked.
   */
  getRequestTime(requestID) {
    if (!this.requestTimes_.has(requestID)) {
      return -1;
    }
    return this.requestTimes_.get(requestID);
  }

  /**
   * Returns the timestamp when the request completed.
   *
   * @param {string} requestID the id of the request.
   *
   * @return {number} the timestamp when the request completed. -1, if the
   * request was never made.
   */
  getCompleteTime(requestID) {
    if (!this.completeTimes_.has(requestID)) {
      return -1;
    }
    return this.completeTimes_.get(requestID);
  }
}
