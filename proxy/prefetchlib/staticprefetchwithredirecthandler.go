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

// Package prefetchlib implements the HTTP handler for sending a templated response.
// The templated response includes a javascript that will add <link rel="prefetch">
// into the DOM tree to prefetch resources. It also populates the URL of the destination
// page to redirect to.
package prefetchlib

import (
	"bytes"
	"compress/gzip"
	"fmt"
  "html/template"
	"io"
	"net/http"
	"net/url"
	"strings"

  "github.com/golang/glog"
)

const (
	redirectTemplate    = "./prefetchlib/static/prefetch_with_redirection_template.html"
	defaultPrefetchPriority = 0

	// The delimeter to split the prefetch URLS.
	// |$de| contains a combination of characters that is unlikely to appear together.
	delim = "|$de|"
)

// Handler defines the prefetchproxyhandler.Handler type.
type redirectHandler struct {
	htmlTemplate        *template.Template     // The stub to be sent back with the initial response.
	prefetchURLProvider *Provider              // The instance for looking up the prefetch URLs.
}

// New returns a new prefetchproxyhandler object.
func New(prefetchURLsFilename string) (*redirectHandler, error) {
	prefetchURLProvider, err := NewProvider(prefetchURLsFilename)
	if err != nil {
		return nil, err
	}

	newHandler := &redirectHandler{
		htmlTemplate:        template.Must(template.ParseFiles(redirectTemplate)),
		prefetchURLProvider: prefetchURLProvider,
	}
	return newHandler, nil
}

// Implements the handle function for serving a HTTP request.
func (h *redirectHandler) ServeHTTP(rw http.ResponseWriter, req *http.Request) {
	if !req.URL.IsAbs() {
		req.URL.Scheme = "http"
		req.URL.Host = req.Host
	}

	glog.Infof("Serving: %v", req.URL.String())

	// Check if the request has a URL to generate the page for.
	// The given URL should be escaped by replacing / with _ and
	// remove any trailing "_" from the URL.
	//
	// This must be specified in the query string with the
	// query parameter as "lp".
	query := req.URL.Query()
	lp := query.Get("lp")
  if lp == "" {
		glog.Errorf("got an invalid request: %v", req.URL)
		http.Error(rw, "", http.StatusBadRequest)
		return
  }

	unescapedURL, err := url.PathUnescape(lp)
	if err != nil {
		glog.Errorf("could not unescape lp query parameter: %v", lp)
		http.Error(rw, "", http.StatusBadRequest)
	}

	dstURL, err := url.Parse(unescapedURL)
	if err != nil {
		glog.Errorf("could not parse URL: %v", req.URL)
		http.Error(rw, "", http.StatusBadRequest)
	}
	rw.Header().Set("x-lp-url", dstURL.String())

	prefetchURLs := []Resource{}
	prefetch := req.Header.Get("x-req-prefetch")
  if prefetch == "" {
    prefetch = query.Get("prefetch")
  }
	if prefetch != "" {
		prefetchURLsStored, err := h.prefetchURLProvider.GetPrefetchURLs(dstURL.String(), prefetch)
		if err != nil {
			glog.Errorf("failed to get prefetch URLs for %v with experiment ID: %v error: %v", dstURL.String(), prefetch, err)
			http.Error(rw, "", http.StatusInternalServerError)
			return
		}
		prefetchURLs = append(prefetchURLs, prefetchURLsStored...)
	} else {
	  glog.Infof("No prefetching requested. Just redirecting to %v", dstURL.String())
  }

	rw.Header().Set("Content-Type", "text/html")
	rw.Header().Set("Referrer-Policy", "no-referrer")
	rw.Header().Set("Access-Control-Allow-Origin", "*")
	rw.Header().Set("Content-Encoding", "gzip")

	returnViaHTTPHeader := req.Header.Get("x-via-header")
	if returnViaHTTPHeader == "1" {
		// Put the rest in a HTTP header.
		prefetchHeaderValue := []string{}
		for _, url := range prefetchURLs {
			prefetchHeaderValue = append(prefetchHeaderValue, generatePrefetchHeaderString(url))
		}
		rw.Header().Set("x-prefetch", strings.Join(prefetchHeaderValue, delim))
		prefetchURLs = nil
	}
	writer, err := gzip.NewWriterLevel(rw, gzip.BestCompression)
	if err != nil {
		glog.Errorf("failed to get gzip writer: %v", err)
		http.Error(rw, "", http.StatusBadGateway)
		return
	}
	defer writer.Close()

	// Generate the snippet for navigating to the final page.
	var URLs []string
	for _, pfURL := range prefetchURLs {
		URLs = append(URLs, pfURL.URL)
	}

	templateData := struct {
		PrefetchURLs   []string
		RedirectScript template.JS
	}{
		PrefetchURLs: URLs,
    RedirectScript: template.JS(fmt.Sprintf("var dstURL='%s';\nwindow.location.assign(dstURL);", dstURL.String())),
	}
	targetPageBuf := &bytes.Buffer{}
	err = h.htmlTemplate.Execute(targetPageBuf, templateData)
	if err != nil {
		glog.Errorf("template.Execute: %v\n", err)
		http.Error(rw, "", http.StatusBadGateway)
		return
	}
  glog.V(5).Infof("%v", targetPageBuf)

	_, err = io.Copy(writer, targetPageBuf)
	if err != nil {
		glog.Errorf("error writing to network: %v", err)
	}
}

// generatePrefetchHeaderString generates the string representing a resource
// to be prefetched that will be included with the x-prefetch HTTP header.
func generatePrefetchHeaderString(resource Resource) string {
	return fmt.Sprintf("<%v>; priority=%d; type=%d", resource.URL, resource.Priority, resource.Type)
}
