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

// The prefetch proxy intercepts a request of a landing page and return a
// templated response. The response contains an empty HTML and a javascript
// snippet to populate <link rel="prefetch">, and to redirect to the landing
// page.
package main

import (
	"flag"
	"fmt"
	"net/http"

	"./prefetchlib"
	"github.com/golang/glog"
)

var (
	port                 = flag.Int("port", 8080, "The port the proxy will listen to.")
	certFile             = flag.String("cert_file", "mycert.pem", "The SSL certificate file.")
	keyFile              = flag.String("key_file", "mykey.pem", "The SSL key file.")
	prefetchURLsFilename = flag.String("prefetch_urls", "prefetchURLs.json", "The file containing the URLs to be fetched in JSON format described in prefetchurls.go")
)

func main() {
	handler, err := prefetchlib.New(*prefetchURLsFilename)
	if err != nil {
		glog.Fatal("Failed to create Prefetch Proxy Handler handler: %v\n", err)
	}
	http.Handle("/", handler)

	server := &http.Server{
		Addr: fmt.Sprintf(":%d", *port),
	}
	glog.V(1).Infof("PORT %d CERTS: %v %v\n", *port, *certFile, *keyFile)
	glog.Fatal(server.ListenAndServeTLS(*certFile, *keyFile))
}
