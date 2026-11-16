//! Linux fence: Landlock for files (and TCP on newer kernels), seccomp for
//! sockets, new processes and debugging calls, and rlimits.

use crate::policy::Policy;
use landlock::{
    ABI, Access, AccessFs, AccessNet, CompatLevel, Compatible, PathBeneath, PathFd, Ruleset,
    RulesetAttr, RulesetCreatedAttr, RulesetStatus, Scope,
};
use seccompiler::{
    BpfProgram, SeccompAction, SeccompCmpArgLen, SeccompCmpOp, SeccompCondition, SeccompFilter,
    SeccompRule, TargetArch,
};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// What the dynamic loader and the Node runtime read at start.
const SYSTEM_READ: &[&str] = &[
    "/lib",
    "/lib64",
    "/usr/lib",
    "/usr/lib64",
    "/etc/ld.so.cache",
    "/etc/ld.so.conf",
    "/etc/ld.so.conf.d",
    "/etc/localtime",
    "/etc/ssl/openssl.cnf",
    "/usr/share/zoneinfo",
    "/dev/urandom",
    "/dev/random",
    "/proc/self",
    "/proc/thread-self",
    "/proc/meminfo",
    "/proc/cpuinfo",
    "/proc/stat",
    "/proc/loadavg",
    "/proc/version",
    "/sys/fs/cgroup",
    "/sys/devices/system/cpu",
];

/// Extra reads for a process that may open sockets: name lookup and CAs.
const NET_READ: &[&str] = &[
    "/etc/resolv.conf",
    "/etc/hosts",
    "/etc/nsswitch.conf",
    "/etc/gai.conf",
    "/etc/ssl",
    "/etc/pki",
    "/etc/ca-certificates",
    "/usr/share/ca-certificates",
];

/// Serial devices and what the serial library reads to list them.
const SERIAL_WRITE: &[&str] = &["/dev/serial"];
const SERIAL_READ: &[&str] = &["/sys/class/tty", "/sys/devices", "/sys/bus", "/run/udev"];
const SERIAL_PREFIXES: &[&str] = &["ttyS", "ttyUSB", "ttyACM", "ttyAMA", "rfcomm"];

fn serial_devices() -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir("/dev") else {
        return Vec::new();
    };
    entries
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name();
            let name = name.to_string_lossy();
            SERIAL_PREFIXES.iter().any(|p| name.starts_with(p))
        })
        .map(|e| e.path())
        .collect()
}

/// Extra reads for a process that may start programs.
const SPAWN_READ: &[&str] = &[
    "/bin",
    "/sbin",
    "/usr/bin",
    "/usr/sbin",
    "/usr/local/bin",
    "/usr/share",
    "/etc",
];

pub struct Prepared {
    read: Vec<PathBuf>,
    write: Vec<PathBuf>,
    filters: Vec<BpfProgram>,
}

fn existing(paths: impl IntoIterator<Item = PathBuf>) -> Vec<PathBuf> {
    paths.into_iter().filter(|p| p.exists()).collect()
}

fn arch() -> TargetArch {
    #[cfg(target_arch = "x86_64")]
    return TargetArch::x86_64;
    #[cfg(target_arch = "aarch64")]
    return TargetArch::aarch64;
    #[cfg(target_arch = "riscv64")]
    return TargetArch::riscv64;
}

fn filter(rules: BTreeMap<i64, Vec<SeccompRule>>, errno: i32) -> Result<BpfProgram, String> {
    let filter = SeccompFilter::new(
        rules,
        SeccompAction::Allow,
        SeccompAction::Errno(errno as u32),
        arch(),
    )
    .map_err(|e| format!("seccomp: {e}"))?;
    filter.try_into().map_err(|e| format!("seccomp: {e:?}"))
}

fn build_filters(policy: &Policy) -> Result<Vec<BpfProgram>, String> {
    let mut deny: BTreeMap<i64, Vec<SeccompRule>> = BTreeMap::new();
    // Never: debugging other processes, reading their memory, io_uring
    // (its socket and file ops would get around the rules below).
    for call in [
        libc::SYS_ptrace,
        libc::SYS_process_vm_readv,
        libc::SYS_process_vm_writev,
        libc::SYS_io_uring_setup,
        libc::SYS_bpf,
        libc::SYS_perf_event_open,
        libc::SYS_userfaultfd,
        libc::SYS_keyctl,
        libc::SYS_add_key,
        libc::SYS_request_key,
    ] {
        deny.insert(call, vec![]);
    }
    if !policy.net {
        deny.insert(libc::SYS_socket, vec![]);
    }
    let mut programs = Vec::new();
    if !policy.child_process {
        // Threads pass CLONE_THREAD; a new process does not.
        let new_process = SeccompRule::new(vec![
            SeccompCondition::new(
                0,
                SeccompCmpArgLen::Qword,
                SeccompCmpOp::MaskedEq(libc::CLONE_THREAD as u64),
                0,
            )
            .map_err(|e| format!("seccomp: {e}"))?,
        ])
        .map_err(|e| format!("seccomp: {e}"))?;
        deny.insert(libc::SYS_clone, vec![new_process]);
        #[cfg(target_arch = "x86_64")]
        {
            deny.insert(libc::SYS_fork, vec![]);
            deny.insert(libc::SYS_vfork, vec![]);
        }
        // clone3 hides its flags in memory seccomp can't read. ENOSYS makes
        // the C library fall back to clone for threads.
        let mut clone3: BTreeMap<i64, Vec<SeccompRule>> = BTreeMap::new();
        clone3.insert(libc::SYS_clone3, vec![]);
        programs.push(filter(clone3, libc::ENOSYS)?);
    }
    programs.push(filter(deny, libc::EPERM)?);
    Ok(programs)
}

pub fn prepare(policy: &Policy, program: &str) -> Result<Prepared, String> {
    let mut read: Vec<PathBuf> = policy.read.clone();
    if let Some(dir) = Path::new(program).parent() {
        read.push(dir.to_path_buf());
        // The app ships libatomic beside Node, which many desktops lack.
        // Core never passes LD_ variables to a plugin, so nothing is lost.
        unsafe { std::env::set_var("LD_LIBRARY_PATH", dir) };
    }
    read.extend(SYSTEM_READ.iter().map(PathBuf::from));
    if policy.net {
        read.extend(NET_READ.iter().map(PathBuf::from));
    }
    if policy.child_process {
        read.extend(SPAWN_READ.iter().map(PathBuf::from));
    }
    let mut write = policy.write.clone();
    write.push(PathBuf::from("/dev/null"));
    if policy.addons {
        read.extend(SERIAL_READ.iter().map(PathBuf::from));
        write.extend(SERIAL_WRITE.iter().map(PathBuf::from));
        write.extend(serial_devices());
    }
    for dir in &policy.write {
        std::fs::create_dir_all(dir).map_err(|e| format!("data folder: {e}"))?;
    }
    Ok(Prepared {
        read: existing(read),
        write: existing(write),
        filters: build_filters(policy)?,
    })
}

#[cfg(target_env = "gnu")]
type Resource = libc::__rlimit_resource_t;
#[cfg(not(target_env = "gnu"))]
type Resource = libc::c_int;

fn set_limit(resource: Resource, value: u64) {
    let limit = libc::rlimit {
        rlim_cur: value as libc::rlim_t,
        rlim_max: value as libc::rlim_t,
    };
    unsafe {
        libc::setrlimit(resource, &limit);
    }
}

fn landlock(policy: &Policy, prepared: &Prepared) -> Result<RulesetStatus, String> {
    let abi = ABI::V6;
    let err = |e: landlock::RulesetError| format!("landlock: {e}");
    let mut ruleset = Ruleset::default()
        .set_compatibility(CompatLevel::BestEffort)
        .handle_access(AccessFs::from_all(abi))
        .map_err(err)?
        .scope(Scope::Signal)
        .map_err(err)?;
    if !policy.net {
        ruleset = ruleset
            .handle_access(AccessNet::from_all(abi))
            .map_err(err)?
            .scope(Scope::AbstractUnixSocket)
            .map_err(err)?;
    }
    let mut created = ruleset.create().map_err(err)?;
    for (paths, access) in [
        (&prepared.read, AccessFs::from_read(abi)),
        (&prepared.write, AccessFs::from_all(abi)),
    ] {
        for path in paths {
            let Ok(fd) = PathFd::new(path) else { continue };
            let access = if path.is_dir() {
                access
            } else {
                access & AccessFs::from_file(abi)
            };
            created = created
                .add_rule(PathBeneath::new(fd, access))
                .map_err(err)?;
        }
    }
    let status = created.restrict_self().map_err(err)?;
    Ok(status.ruleset)
}

pub fn enter(policy: &Policy, prepared: Prepared) -> Result<(), String> {
    unsafe {
        // Dies with the helper, so a killed helper never leaves it running.
        libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL);
        if libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0 {
            return Err("no_new_privs failed".into());
        }
        libc::prctl(libc::PR_SET_DUMPABLE, 0);
    }
    set_limit(libc::RLIMIT_CORE, 0);
    // A backstop under the memory watch. V8 reserves its code range against
    // this limit at start, so it can't be the cap itself.
    set_limit(libc::RLIMIT_DATA, policy.memory_bytes() * 4);

    match landlock(policy, &prepared)? {
        RulesetStatus::FullyEnforced | RulesetStatus::PartiallyEnforced => {}
        RulesetStatus::NotEnforced => {
            eprintln!("termix-plugin-jail: this kernel has no Landlock, files rely on Node");
        }
    }
    for program in &prepared.filters {
        seccompiler::apply_filter(program).map_err(|e| format!("seccomp: {e}"))?;
    }
    Ok(())
}

pub fn resident_bytes(pid: libc::pid_t) -> Option<u64> {
    let text = std::fs::read_to_string(format!("/proc/{pid}/statm")).ok()?;
    let pages: u64 = text.split_whitespace().nth(1)?.parse().ok()?;
    let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    Some(pages * page.max(4096) as u64)
}
