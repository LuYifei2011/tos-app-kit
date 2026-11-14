package tosapp

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestDevelopmentListenerRejectsNonLoopbackAddresses(t *testing.T) {
	for _, address := range []string{"0.0.0.0:0", ":0", "192.0.2.2:0", "[::]:0", "localhost:0", "invalid"} {
		if listener, err := ListenLoopback(address); err == nil {
			listener.Close()
			t.Fatalf("accepted %q", address)
		}
	}
}

func TestServeWaitsForInflightRequestsAfterStoppingProducers(t *testing.T) {
	listener, err := ListenLoopback("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	entered, release, stopping := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var once sync.Once
	releaseHandler := func() { once.Do(func() { close(release) }) }
	defer releaseHandler()
	server := NewHTTPServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(entered); <-release; io.WriteString(w, "finished") }))
	defer server.Close()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- Serve(ctx, server, listener, ServeOptions{BeforeShutdown: func() { close(stopping) }}) }()
	responseDone := make(chan error, 1)
	go func() {
		response, err := http.Get("http://" + listener.Addr().String())
		if err == nil {
			defer response.Body.Close()
			var body []byte
			body, err = io.ReadAll(response.Body)
			if string(body) != "finished" {
				err = fmt.Errorf("unexpected response %q", body)
			}
		}
		responseDone <- err
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("handler did not start")
	}
	cancel()
	select {
	case <-stopping:
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown callback did not run")
	}
	select {
	case err := <-done:
		t.Fatalf("returned before request drain: %v", err)
	default:
	}
	releaseHandler()
	select {
	case err := <-responseDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("request did not finish")
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Serve did not return")
	}
}

func TestServeTimeoutClosesActiveConnections(t *testing.T) {
	listener, err := ListenLoopback("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	entered, handlerDone := make(chan struct{}), make(chan struct{})
	server := NewHTTPServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(entered); <-r.Context().Done(); close(handlerDone) }))
	defer server.Close()
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- Serve(ctx, server, listener, ServeOptions{ShutdownTimeout: 10 * time.Millisecond}) }()
	go func() {
		response, err := http.Get("http://" + listener.Addr().String())
		if err == nil {
			response.Body.Close()
		}
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("handler did not start")
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("lost shutdown deadline: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown exceeded its deadline")
	}
	select {
	case <-handlerDone:
	case <-time.After(5 * time.Second):
		t.Fatal("active request was not cancelled")
	}
}

func TestServeReturnsListenerErrors(t *testing.T) {
	listener, err := ListenLoopback("127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	listener.Close()
	if err := Serve(t.Context(), NewHTTPServer(http.NotFoundHandler()), listener, ServeOptions{}); err == nil {
		t.Fatal("listener failure discarded")
	}
}

func TestActivationRejectsWrongProcessOrDescriptorCount(t *testing.T) {
	t.Setenv("LISTEN_PID", "0")
	t.Setenv("LISTEN_FDS", "1")
	if _, err := SystemdListener(); err == nil {
		t.Fatal("wrong process accepted")
	}
	t.Setenv("LISTEN_PID", fmt.Sprint(os.Getpid()))
	t.Setenv("LISTEN_FDS", "2")
	if _, err := SystemdListener(); err == nil {
		t.Fatal("multiple sockets accepted")
	}
}

func TestActivationWithInheritedDescriptor(t *testing.T) {
	for _, network := range []string{"unix", "tcp", "unixgram"} {
		t.Run(network, func(t *testing.T) {
			directory, err := os.MkdirTemp("/tmp", "tos-core-")
			if err != nil {
				t.Fatal(err)
			}
			defer os.RemoveAll(directory)
			var file *os.File
			if network == "unixgram" {
				connection, e := net.ListenUnixgram("unixgram", &net.UnixAddr{Name: filepath.Join(directory, "api.sock"), Net: "unixgram"})
				if e != nil {
					t.Fatal(e)
				}
				defer connection.Close()
				file, err = connection.File()
			} else {
				var listener net.Listener
				if network == "unix" {
					listener, err = net.Listen("unix", filepath.Join(directory, "api.sock"))
				} else {
					listener, err = ListenLoopback("127.0.0.1:0")
				}
				if err != nil {
					t.Fatal(err)
				}
				defer listener.Close()
				file, err = listener.(interface{ File() (*os.File, error) }).File()
			}
			if err != nil {
				t.Fatal(err)
			}
			defer file.Close()
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestActivationHelper$")
			command.Env = append(os.Environ(), "TOS_CORE_ACTIVATION_HELPER="+network)
			command.ExtraFiles = []*os.File{file}
			if output, err := command.CombinedOutput(); err != nil {
				t.Fatalf("activation child: %v\n%s", err, output)
			}
		})
	}
}

func TestActivationHelper(t *testing.T) {
	network := os.Getenv("TOS_CORE_ACTIVATION_HELPER")
	if network == "" {
		t.Skip("subprocess helper")
	}
	os.Setenv("LISTEN_PID", fmt.Sprint(os.Getpid()))
	os.Setenv("LISTEN_FDS", "1")
	listener, err := SystemdListener()
	if network != "unix" {
		if err == nil {
			listener.Close()
			t.Fatal("non-stream-Unix activation accepted")
		}
		return
	}
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	server := NewHTTPServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { WriteJSON(w, 200, map[string]bool{"ok": true}) }))
	defer server.Close()
	go server.Serve(listener)
	client := &http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", listener.Addr().String())
	}}}
	defer client.CloseIdleConnections()
	response, err := client.Get("http://localhost/api/status")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil || response.StatusCode != 200 || string(body) != "{\"ok\":true}\n" {
		t.Fatalf("inherited HTTP socket failed: %v, %q", err, body)
	}
}
