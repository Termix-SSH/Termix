//! Starts one Termix desktop plugin process inside the OS sandbox, then waits
//! for it and passes its exit code on.
//!
//!   termix-plugin-jail [--no-seatbelt] <policy json> -- <node> <args...>
//!
//! --no-seatbelt is for the Mac App Store build, which already runs inside
//! Apple's app sandbox (it can't be nested); the memory watch still applies.
//!
//! Windows: AppContainer plus a job object. macOS: a Seatbelt profile.
//! Linux: Landlock, seccomp and rlimits. The process inherits this one's
//! stdin, stdout and stderr, which carry its channel to the app.

mod policy;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

use policy::Policy;
use std::process::exit;

/// Exit code when the process went over its memory cap.
pub const EXIT_MEMORY: i32 = 86;
/// Exit code when the fence could not be set up.
pub const EXIT_FENCE: i32 = 87;

fn main() {
    let mut args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--no-seatbelt") {
        if !cfg!(target_os = "macos") {
            usage();
        }
        #[cfg(target_os = "macos")]
        macos::SKIP_SEATBELT.store(true, std::sync::atomic::Ordering::SeqCst);
        args.remove(1);
    }
    let Some(split) = args.iter().position(|a| a == "--") else {
        usage();
    };
    if split != 2 || split + 1 >= args.len() {
        usage();
    }
    let policy = match Policy::parse(&args[1]) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("termix-plugin-jail: {e}");
            exit(EXIT_FENCE);
        }
    };
    let program = &args[split + 1];
    let rest = &args[split + 2..];

    #[cfg(windows)]
    let code = windows::run(&policy, program, rest);
    #[cfg(unix)]
    let code = unix::run(&policy, program, rest);

    exit(code);
}

fn usage() -> ! {
    eprintln!("usage: termix-plugin-jail [--no-seatbelt] <policy json> -- <program> [args...]");
    exit(EXIT_FENCE);
}
