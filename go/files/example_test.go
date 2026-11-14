package files_test

import (
	nasfiles "github.com/LuYifei2011/tos-app-kit/go/files"
	"net/http"
)

func ExampleHandler_Register() {
	mux := http.NewServeMux()
	handler, err := nasfiles.NewHandler(nasfiles.Options{AppID: "my-app"})
	if err != nil {
		panic(err)
	}
	defer handler.Close()
	handler.Register(mux)
	// Pass mux to the application's existing HTTP server.
	// In the browser: createTosApp({ id: 'my-app', files: true }).
}
