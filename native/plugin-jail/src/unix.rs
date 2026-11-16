//! Fork, fence the child, exec the runtime, and watch its memory.

use crate::policy::Policy;
use crate::{EXIT_FENCE, EXIT_MEMORY};
use std::ffi::CString;
use std::sync::atomic::{AtomicI32, Ordering};
use std::time::Duration;

#[cfg(target_os = "linux")]
use crate::linux as platform;
#[cfg(target_os = "macos")]
use crate::macos as platform;

static CHILD: AtomicI32 = AtomicI32::new(0);

extern "C" fn stop_child(_: libc::c_int) {
    let pid = CHILD.load(Ordering::SeqCst);
    if pid > 0 {
        unsafe {
            libc::kill(pid, libc::SIGKILL);
        }
    }
}

/// Writes to stderr from the fenced child. eprintln! would abort the
/// process if the fence refused the write, hiding the reason.
fn say(text: &str) {
    unsafe {
        libc::write(2, text.as_ptr().cast(), text.len());
    }
}

fn cstring(text: &str) -> CString {
    CString::new(text).unwrap_or_else(|_| {
        eprintln!("termix-plugin-jail: argument with a NUL byte");
        std::process::exit(EXIT_FENCE);
    })
}

/// The largest resident size any ended child reached.
fn peak_bytes() -> u64 {
    let mut usage: libc::rusage = unsafe { std::mem::zeroed() };
    if unsafe { libc::getrusage(libc::RUSAGE_CHILDREN, &mut usage) } != 0 {
        return 0;
    }
    let peak = usage.ru_maxrss.max(0) as u64;
    // Linux reports kilobytes, macOS bytes.
    if cfg!(target_os = "linux") {
        peak * 1024
    } else {
        peak
    }
}

pub fn run(policy: &Policy, program: &str, rest: &[String]) -> i32 {
    let path = cstring(program);
    let mut argv: Vec<CString> = vec![path.clone()];
    argv.extend(rest.iter().map(|a| cstring(a)));
    let mut argv_ptrs: Vec<*const libc::c_char> = argv.iter().map(|a| a.as_ptr()).collect();
    argv_ptrs.push(std::ptr::null());

    // Everything the child needs is built before fork; this process has one thread.
    let prepared = match platform::prepare(policy, program) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("termix-plugin-jail: {e}");
            return EXIT_FENCE;
        }
    };

    let pid = unsafe { libc::fork() };
    if pid < 0 {
        eprintln!("termix-plugin-jail: fork failed");
        return EXIT_FENCE;
    }
    if pid == 0 {
        if let Err(e) = platform::enter(policy, prepared) {
            say(&format!("termix-plugin-jail: {e}\n"));
            unsafe { libc::_exit(EXIT_FENCE) };
        }
        unsafe {
            libc::execv(path.as_ptr(), argv_ptrs.as_ptr());
        }
        let error = std::io::Error::last_os_error();
        say(&format!(
            "termix-plugin-jail: could not start the runtime: {error}\n"
        ));
        unsafe { libc::_exit(EXIT_FENCE) };
    }

    CHILD.store(pid, Ordering::SeqCst);
    unsafe {
        let handler = stop_child as extern "C" fn(libc::c_int) as libc::sighandler_t;
        libc::signal(libc::SIGTERM, handler);
        libc::signal(libc::SIGINT, handler);
        libc::signal(libc::SIGHUP, handler);
    }

    let cap = policy.memory_bytes();
    let mut over_cap = false;
    loop {
        let mut status: libc::c_int = 0;
        let done = unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) };
        if done == pid {
            let failed = !(libc::WIFEXITED(status) && libc::WEXITSTATUS(status) == 0);
            if !over_cap && failed && peak_bytes() * 4 >= cap * 3 {
                over_cap = true;
                eprintln!(
                    "termix-plugin-jail: memory limit of {} MB reached, stopping",
                    policy.memory_mb
                );
            }
            if over_cap {
                return EXIT_MEMORY;
            }
            if libc::WIFEXITED(status) {
                return libc::WEXITSTATUS(status);
            }
            if libc::WIFSIGNALED(status) {
                return 128 + libc::WTERMSIG(status);
            }
            return 1;
        }
        if done < 0 {
            return 1;
        }
        let used = if over_cap {
            None
        } else {
            platform::resident_bytes(pid)
        };
        if used.is_some_and(|used| used > cap) {
            over_cap = true;
            eprintln!(
                "termix-plugin-jail: memory limit of {} MB reached, stopping",
                policy.memory_mb
            );
            unsafe {
                libc::kill(pid, libc::SIGKILL);
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}
