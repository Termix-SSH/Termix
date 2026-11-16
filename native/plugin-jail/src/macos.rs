//! macOS fence: a Seatbelt profile applied to the child before it runs Node.

use crate::policy::Policy;
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int};
use std::path::{Path, PathBuf};

unsafe extern "C" {
    fn sandbox_init_with_parameters(
        profile: *const c_char,
        flags: u64,
        parameters: *const *const c_char,
        errorbuf: *mut *mut c_char,
    ) -> c_int;
    fn sandbox_free_error(errorbuf: *mut c_char);
}

/// Set for the Mac App Store build, see main.rs.
pub static SKIP_SEATBELT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

pub struct Prepared {
    profile: CString,
}

/// What dyld and the Node runtime read at start.
const SYSTEM_READ: &[&str] = &[
    "/usr/lib",
    "/usr/share/icu",
    "/usr/share/zoneinfo",
    "/System/Library",
    // dyld shared cache on macOS 13 and later, and before.
    "/System/Volumes/Preboot/Cryptexes/OS",
    "/private/var/db/dyld",
    "/Library/Preferences/Logging",
    "/private/var/db/timezone",
    "/private/etc/localtime",
    "/dev/urandom",
    "/dev/random",
];

const NET_READ: &[&str] = &[
    "/private/etc/hosts",
    "/private/etc/resolv.conf",
    "/private/var/run/resolv.conf",
    "/private/etc/ssl",
];

const SPAWN_READ: &[&str] = &["/bin", "/usr/bin", "/usr/sbin", "/sbin", "/private/etc"];

fn quote(path: &Path) -> String {
    let text = path.to_string_lossy();
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for ch in text.chars() {
        if ch == '"' || ch == '\\' {
            out.push('\\');
        }
        out.push(ch);
    }
    out.push('"');
    out
}

/// Seatbelt checks the resolved path (/var is /private/var).
fn resolved(paths: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    paths
        .into_iter()
        .filter_map(|p| std::fs::canonicalize(&p).ok())
        .collect()
}

fn subpaths(paths: &[PathBuf]) -> String {
    paths
        .iter()
        .map(|p| {
            if p.is_dir() {
                format!("(subpath {})", quote(p))
            } else {
                format!("(literal {})", quote(p))
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn profile(policy: &Policy, program: &Path) -> String {
    let mut read: Vec<PathBuf> = policy.read.clone();
    if let Some(dir) = program.parent() {
        read.push(dir.to_path_buf());
    }
    read.extend(SYSTEM_READ.iter().map(PathBuf::from));
    if policy.net {
        read.extend(NET_READ.iter().map(PathBuf::from));
    }
    if policy.child_process {
        read.extend(SPAWN_READ.iter().map(PathBuf::from));
    }
    let read = resolved(read);
    let write = resolved(policy.write.clone());
    let program = std::fs::canonicalize(program).unwrap_or_else(|_| program.to_path_buf());

    let mut rules = vec![
        "(version 1)".to_string(),
        "(deny default)".to_string(),
        // Apple's baseline every process needs (dyld, its own descriptors,
        // basic system services); files, network and processes stay closed.
        "(import \"system.sb\")".to_string(),
        "(allow file-read-metadata)".to_string(),
        "(allow sysctl-read)".to_string(),
        // V8 writes its own machine code.
        "(allow dynamic-code-generation)".to_string(),
        "(allow signal (target self))".to_string(),
        "(allow process-info* (target self))".to_string(),
        "(allow mach-lookup (global-name \"com.apple.system.notification_center\"))".to_string(),
        "(allow ipc-posix-shm-read-data (ipc-posix-name \"apple.shm.notification_center\"))"
            .to_string(),
        "(allow file-read* file-write-data (literal \"/dev/null\"))".to_string(),
        format!("(allow process-exec (literal {}))", quote(&program)),
    ];
    if !read.is_empty() {
        rules.push(format!("(allow file-read* {})", subpaths(&read)));
        // Loading code is its own operation: dyld maps libraries and addons
        // from the same places the process may read.
        rules.push(format!("(allow file-map-executable {})", subpaths(&read)));
    }
    if !write.is_empty() {
        rules.push(format!(
            "(allow file-read* file-write* {})",
            subpaths(&write)
        ));
    }
    if policy.net {
        rules.push("(allow network*)".to_string());
        rules.push("(allow system-socket)".to_string());
        rules.push(
            "(allow mach-lookup (global-name \"com.apple.dnssd.service\") (global-name \"com.apple.SystemConfiguration.configd\") (global-name \"com.apple.trustd\") (global-name \"com.apple.trustd.agent\"))"
                .to_string(),
        );
    }
    if policy.addons {
        // Serial ports and the IOKit calls that list them.
        rules.push(r##"(allow file-read* file-write* (regex #"^/dev/(cu|tty)\."))"##.to_string());
        rules.push(r##"(allow file-ioctl (regex #"^/dev/(cu|tty)\."))"##.to_string());
        rules.push("(allow iokit-open)".to_string());
        rules.push("(allow mach-lookup (global-name \"com.apple.iokit.matching\"))".to_string());
    }
    if policy.child_process {
        rules.push("(allow process-fork)".to_string());
        rules.push("(allow process-exec)".to_string());
        rules.push("(allow signal (target children))".to_string());
    }
    rules.join("\n")
}

pub fn prepare(policy: &Policy, program: &str) -> Result<Prepared, String> {
    for dir in &policy.write {
        std::fs::create_dir_all(dir).map_err(|e| format!("data folder: {e}"))?;
    }
    let text = profile(policy, Path::new(program));
    let profile = CString::new(text).map_err(|_| "bad profile".to_string())?;
    Ok(Prepared { profile })
}

pub fn enter(_policy: &Policy, prepared: Prepared) -> Result<(), String> {
    if SKIP_SEATBELT.load(std::sync::atomic::Ordering::SeqCst) {
        return Ok(());
    }
    let none: [*const c_char; 1] = [std::ptr::null()];
    let mut error: *mut c_char = std::ptr::null_mut();
    let rc = unsafe {
        sandbox_init_with_parameters(prepared.profile.as_ptr(), 0, none.as_ptr(), &mut error)
    };
    if rc != 0 {
        let message = if error.is_null() {
            "unknown".to_string()
        } else {
            let text = unsafe { CStr::from_ptr(error) }
                .to_string_lossy()
                .into_owned();
            unsafe { sandbox_free_error(error) };
            text
        };
        return Err(format!("sandbox: {message}"));
    }
    let limit = libc::rlimit {
        rlim_cur: 0,
        rlim_max: 0,
    };
    unsafe {
        libc::setrlimit(libc::RLIMIT_CORE, &limit);
    }
    Ok(())
}

pub fn resident_bytes(pid: libc::pid_t) -> Option<u64> {
    let mut info: libc::rusage_info_v2 = unsafe { std::mem::zeroed() };
    let rc = unsafe {
        libc::proc_pid_rusage(
            pid,
            libc::RUSAGE_INFO_V2,
            &mut info as *mut _ as *mut libc::rusage_info_t,
        )
    };
    if rc != 0 {
        return None;
    }
    Some(info.ri_phys_footprint)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_keeps_network_out_without_the_grant() {
        let policy = Policy::parse(
            r#"{"name":"a","read":["/tmp"],"write":[],"net":false,"childProcess":false,"addons":false,"memoryMb":512}"#,
        )
        .unwrap();
        let text = profile(&policy, Path::new("/usr/bin/true"));
        assert!(text.contains("(deny default)"));
        assert!(!text.contains("network*"));
        assert!(!text.contains("process-fork"));
    }

    #[test]
    fn quote_escapes() {
        assert_eq!(quote(Path::new("/a\"b")), "\"/a\\\"b\"");
    }
}
