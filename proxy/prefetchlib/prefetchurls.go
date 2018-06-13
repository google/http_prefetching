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

// Example JSON structure for prefetch url file.
//   [
//     {
//       "lpUrl": [URL],
//       "experiments": [
//         "experimentId": [identifier for the experiment],
//         "prefetchUrls": [
//           "http://foo.com/r1.js",
//           "http://foo.com/r2.css",
//           "http://foo.com/r1.png"
//          ]
//       ],
//       ...
//    },
//    ...
//   ]

package prefetchlib

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
)

// Resource defines the information of a prefetch resource in the JSON.
type Resource struct {
	URL      string `json:"url"`
	Type     int    `json:"type"` // https://w3c.github.io/preload/#as-attribute.
	Priority int    `json:"priority"`
}

// ExperimentPrefetchURLs represents the type to decode the prefetch URLs for a
// particular experiment of a LP URL in the stored JSON file.
type ExperimentPrefetchURLs struct {
	ID           string     `json:"experimentId"`
	PrefetchURLs []Resource `json:"prefetchUrls"`
}

// PrefetchURLs represents the type to decode the prefetch URLs for a LP URL in JSON.
type PrefetchURLs struct {
	LPURL                  string                   `json:"lpUrl"`
	ExperimentPrefetchURLs []ExperimentPrefetchURLs `json:"experiments"`
}

// Provider defines the type for retrieving the prefetch URLs based on the LP URL and
// the experiment ID.
type Provider struct {
	// Maps from LP URL to experiment ID to slice of prefetch URLs.
	urls map[string]map[string][]Resource
}

// NewProvider returns a new prefetchurls.Provider. It takes in the name of the file containing
// the prefetch URLs stored in JSON format (see example above).
func NewProvider(filename string) (*Provider, error) {
	jsonStr, err := ioutil.ReadFile(filename)
	if err != nil {
		return nil, err
	}
	var pfURLs []PrefetchURLs
	json.Unmarshal(jsonStr, &pfURLs)

	urls := make(map[string]map[string][]Resource)
	for _, pfURL := range pfURLs {
		urls[pfURL.LPURL] = make(map[string][]Resource)
		for _, experimentPrefetchURL := range pfURL.ExperimentPrefetchURLs {
			urls[pfURL.LPURL][experimentPrefetchURL.ID] = experimentPrefetchURL.PrefetchURLs
		}
	}
	return &Provider{urls: urls}, nil
}

// GetPrefetchURLs takes lpURL and experimentID and returns a slice of prefetch URLs.
// When neither lpURL nor experimentID match any entry, the function returns nil with
// an error.
func (p *Provider) GetPrefetchURLs(lpURL, experimentID string) ([]Resource, error) {
	urls := p.urls[lpURL][experimentID]
	if urls == nil {
		return nil, fmt.Errorf("cannot find prefetch URL for %q, %q", lpURL, experimentID)
	}
	return urls, nil
}
