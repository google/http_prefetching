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
 * @fileoverview This file defines the constants for messages.
 */

const MessageType = {
  CONTENT_SCRIPT_INIT: 'content_script_init',
  PREFETCH_RESOURCE: 'prefetch_resource',
  PRELOAD_RESOURCE: 'preload_resource',
  COMPLETED: 'completed',
  LOG_TIMING: 'log_timing',
  NAVIGATED_TO_DST: 'navigated_to_dst',
  DEBUG: 'debug',
  INFO: 'info'
};
