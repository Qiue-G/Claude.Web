#!/usr/bin/env python3
"""PTY bridge - gives the child process a real pseudo-terminal."""
import os, sys, pty, select, signal, errno

def main():
    if len(sys.argv) < 2:
        print("Usage: pty_bridge.py <command> [args...]", file=sys.stderr)
        sys.exit(1)

    # Fork with a pty
    pid, fd = pty.fork()

    if pid == 0:
        # Child: execute the target command
        try:
            os.execve(sys.argv[1], sys.argv[1:], os.environ)
        except Exception as e:
            os._exit(1)
    else:
        # Parent: bridge stdin/stdout with the pty
        # Ignore SIGCHLD to avoid zombies
        signal.signal(signal.SIGCHLD, signal.SIG_DFL)

        stdin_fd = sys.stdin.fileno()
        stdout_fd = sys.stdout.fileno()

        try:
            while True:
                # Use select to wait for data on either stdin or pty
                r, _, _ = select.select([stdin_fd, fd], [], [])

                if stdin_fd in r:
                    try:
                        data = os.read(stdin_fd, 4096)
                    except OSError:
                        data = b''
                    if not data:
                        break
                    try:
                        os.write(fd, data)
                    except OSError:
                        break

                if fd in r:
                    try:
                        data = os.read(fd, 4096)
                    except OSError:
                        data = b''
                    if not data:
                        break
                    try:
                        os.write(stdout_fd, data)
                    except OSError:
                        break
        except (OSError, IOError):
            pass
        finally:
            # Forward exit code
            try:
                _, status = os.waitpid(pid, 0)
                if os.WIFEXITED(status):
                    sys.exit(os.WEXITSTATUS(status))
                elif os.WIFSIGNALED(status):
                    sys.exit(128 + os.WTERMSIG(status))
            except OSError:
                pass
            sys.exit(0)

if __name__ == '__main__':
    main()
