package tosapp

import (
	"errors"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

func validAppID(id string) bool {
	if id == "" || id[0] < 'a' || id[0] > 'z' {
		return false
	}
	return strings.IndexFunc(id, func(r rune) bool { return (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '-' }) < 0
}

func RequireNonRoot() error {
	if os.Geteuid() == 0 {
		return errors.New("TOS requires a non-root service user")
	}
	return nil
}

// PrepareAppData is for a privileged service-manager pre-start step only.
// appID must be a trusted application constant, never a request parameter.
func PrepareAppData(appID string) error {
	if !validAppID(appID) {
		return errors.New("invalid TOS application ID")
	}
	if os.Geteuid() != 0 {
		return errors.New("data initialization must be invoked by the system service manager")
	}
	account, err := user.Lookup(appID)
	if err != nil {
		return fmt.Errorf("TOS application account is unavailable: %w", err)
	}
	uid, err := strconv.Atoi(account.Uid)
	if err != nil || uid <= 0 {
		return errors.New("TOS application account must have a non-root UID")
	}
	gid, err := strconv.Atoi(account.Gid)
	if err != nil || gid <= 0 {
		return errors.New("TOS application account must have a non-root primary group")
	}
	return PrepareDataDirectory(filepath.Join("/usr/local", appID), uid, gid)
}

// PrepareDataDirectory pins the trusted application directory target, allowing
// an installation-path symlink. It rejects a symlink at data itself and adjusts
// only that directory, never walking or changing its children.
func PrepareDataDirectory(appDirectory string, uid, gid int) error {
	if uid < 0 || gid < 0 {
		return errors.New("directory ownership IDs must be nonnegative")
	}
	parent, err := os.Open(appDirectory)
	if err != nil {
		return fmt.Errorf("open application directory: %w", err)
	}
	defer parent.Close()
	if err := unix.Mkdirat(int(parent.Fd()), "data", 0700); err != nil && !errors.Is(err, unix.EEXIST) {
		return fmt.Errorf("create data directory: %w", err)
	}
	fd, err := unix.Openat(int(parent.Fd()), "data", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return fmt.Errorf("data must be a real directory: %w", err)
	}
	defer unix.Close(fd)
	if err := unix.Fchown(fd, uid, gid); err != nil {
		return fmt.Errorf("set data directory owner: %w", err)
	}
	if err := unix.Fchmod(fd, 0700); err != nil {
		return fmt.Errorf("set data directory permissions: %w", err)
	}
	return nil
}

func CheckDataDirectory(data string) error {
	info, err := os.Lstat(data)
	if err != nil {
		return fmt.Errorf("data directory is unavailable; enable the application through TOS: %w", err)
	}
	if !info.IsDir() {
		return errors.New("data must be a directory, not a symbolic link")
	}
	if err := unix.Access(data, unix.R_OK|unix.W_OK|unix.X_OK); err != nil {
		return fmt.Errorf("application account cannot access the data directory: %w", err)
	}
	return nil
}
