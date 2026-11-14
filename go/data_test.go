package tosapp

import (
	"os"
	"path/filepath"
	"testing"
)

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestPrepareDataPreservesHistoryAndRestrictsPermissions(t *testing.T) {
	app := t.TempDir()
	data := filepath.Join(app, "data")
	if err := PrepareDataDirectory(app, os.Getuid(), os.Getgid()); err != nil {
		t.Fatal(err)
	}
	write(t, filepath.Join(data, "history.json"), "preserved")
	if err := os.Chmod(data, 0755); err != nil {
		t.Fatal(err)
	}
	if err := PrepareDataDirectory(app, os.Getuid(), os.Getgid()); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(data)
	if err != nil || info.Mode().Perm() != 0700 {
		t.Fatalf("data directory permissions: %v, %v", info, err)
	}
	if content, _ := os.ReadFile(filepath.Join(data, "history.json")); string(content) != "preserved" {
		t.Fatal("initialization changed history")
	}
	if err := CheckDataDirectory(data); err != nil {
		t.Fatal(err)
	}
}

func TestPrepareDataRejectsSymlinksAndFiles(t *testing.T) {
	for _, kind := range []string{"symlink", "file"} {
		t.Run(kind, func(t *testing.T) {
			app := t.TempDir()
			external := t.TempDir()
			before, _ := os.Stat(external)
			data := filepath.Join(app, "data")
			if kind == "symlink" {
				if err := os.Symlink(external, data); err != nil {
					t.Fatal(err)
				}
			} else {
				write(t, data, "keep")
			}
			if err := PrepareDataDirectory(app, os.Getuid(), os.Getgid()); err == nil {
				t.Fatal("unsafe data path accepted")
			}
			if err := CheckDataDirectory(data); err == nil {
				t.Fatal("startup accepted unsafe data path")
			}
			after, _ := os.Stat(external)
			if after.Mode() != before.Mode() {
				t.Fatal("changed the external directory")
			}
		})
	}
}

func TestStartupRejectsMissingData(t *testing.T) {
	if err := CheckDataDirectory(filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("missing data directory accepted")
	}
}

func TestStartupRejectsUnwritableData(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("requires an unprivileged account")
	}
	data := t.TempDir()
	t.Cleanup(func() { os.Chmod(data, 0700) })
	if err := os.Chmod(data, 0500); err != nil {
		t.Fatal(err)
	}
	if err := CheckDataDirectory(data); err == nil {
		t.Fatal("read-only data directory accepted")
	}
}

func TestPrepareDataPinsTrustedApplicationLinkAndValidatesOwnership(t *testing.T) {
	directory := t.TempDir()
	link := filepath.Join(t.TempDir(), "app")
	if err := os.Symlink(directory, link); err != nil {
		t.Fatal(err)
	}
	if err := PrepareDataDirectory(link, os.Getuid(), os.Getgid()); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(filepath.Join(directory, "data")); err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		t.Fatalf("trusted installation target not initialized: %v", err)
	}
	if err := PrepareDataDirectory(directory, -1, os.Getgid()); err == nil {
		t.Fatal("invalid ownership accepted")
	}
	for _, id := range []string{"", "../other", "a/b", "App", "a b"} {
		if err := PrepareAppData(id); err == nil {
			t.Fatalf("invalid app ID %q accepted", id)
		}
	}
}
