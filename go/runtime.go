package tosapp

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"
)

// SystemdListener consumes one inherited Unix stream socket at descriptor 3.
func SystemdListener() (net.Listener, error) {
	if os.Getenv("LISTEN_FDS") != "1" || os.Getenv("LISTEN_PID") != fmt.Sprint(os.Getpid()) {
		return nil, errors.New("TOS mode requires systemd socket activation")
	}
	file := os.NewFile(3, "systemd-socket")
	listener, err := net.FileListener(file)
	file.Close()
	if err != nil {
		return nil, fmt.Errorf("inherit systemd socket: %w", err)
	}
	if _, ok := listener.(*net.UnixListener); !ok || listener.Addr().Network() != "unix" {
		listener.Close()
		return nil, errors.New("systemd socket must be a Unix stream listener")
	}
	return listener, nil
}

func ListenLoopback(address string) (net.Listener, error) {
	host, _, err := net.SplitHostPort(address)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		return nil, errors.New("development listener requires a loopback IP address")
	}
	return net.Listen("tcp", address)
}

// NewHTTPServer returns conservative defaults; apps may adjust the fields.
func NewHTTPServer(handler http.Handler) *http.Server {
	return &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 30 * time.Second, WriteTimeout: 60 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 16384}
}

type ServeOptions struct {
	ShutdownTimeout time.Duration
	// BeforeShutdown stops application producers or marks pending jobs cancelled.
	// It must return promptly; application-specific task draining stays in the app.
	BeforeShutdown func()
}

// Serve owns the listener and waits for HTTP shutdown when ctx is cancelled.
// Signals are selected by the caller, keeping signal registration process-wide.
func Serve(ctx context.Context, server *http.Server, listener net.Listener, options ServeOptions) error {
	if options.ShutdownTimeout < 0 {
		listener.Close()
		return errors.New("shutdown timeout must be nonnegative")
	}
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()
	normalize := func(err error) error {
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
	select {
	case err := <-served:
		return normalize(err)
	case <-ctx.Done():
		if options.BeforeShutdown != nil {
			options.BeforeShutdown()
		}
		timeout := options.ShutdownTimeout
		if timeout == 0 {
			timeout = 30 * time.Second
		}
		shutdown, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		err := server.Shutdown(shutdown)
		if err != nil {
			server.Close()
		}
		serveErr := <-served
		if err != nil {
			return err
		}
		return normalize(serveErr)
	}
}
