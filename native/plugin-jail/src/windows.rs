//! Windows fence: each plugin runs in its own AppContainer, which can open
//! only files granted to its SID and has no network unless given the network
//! capabilities. A job object caps its memory, stops it from starting other
//! processes and kills it when this helper goes away.

use crate::policy::Policy;
use crate::{EXIT_FENCE, EXIT_MEMORY};
use std::ffi::c_void;
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use std::ptr::{null, null_mut};
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, HANDLE, HANDLE_FLAG_INHERIT, INVALID_HANDLE_VALUE, LocalFree,
    SetHandleInformation,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertStringSecurityDescriptorToSecurityDescriptorW, ConvertStringSidToSidW,
    EXPLICIT_ACCESS_W, GRANT_ACCESS, GetNamedSecurityInfoW, GetSecurityInfo, NO_MULTIPLE_TRUSTEE,
    REVOKE_ACCESS, SDDL_REVISION_1, SE_FILE_OBJECT, SE_WINDOW_OBJECT, SetEntriesInAclW,
    SetNamedSecurityInfoW, SetSecurityInfo, TRUSTEE_IS_SID, TRUSTEE_IS_WELL_KNOWN_GROUP, TRUSTEE_W,
};
use windows_sys::Win32::Security::Isolation::{
    CreateAppContainerProfile, DeriveAppContainerSidFromAppContainerName,
};
use windows_sys::Win32::Security::{
    ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_SIZE_INFORMATION, AclSizeInformation,
    CONTAINER_INHERIT_ACE, CreateRestrictedToken, DACL_SECURITY_INFORMATION, DISABLE_MAX_PRIVILEGE,
    EqualSid, FreeSid, GetAce, GetAclInformation, GetLengthSid, GetSecurityDescriptorSacl,
    LABEL_SECURITY_INFORMATION, NO_INHERITANCE, OBJECT_INHERIT_ACE, PSECURITY_DESCRIPTOR, PSID,
    SECURITY_CAPABILITIES, SID_AND_ATTRIBUTES, SetTokenInformation, TOKEN_ADJUST_DEFAULT,
    TOKEN_ASSIGN_PRIMARY, TOKEN_DUPLICATE, TOKEN_MANDATORY_LABEL, TOKEN_QUERY, TokenIntegrityLevel,
};
use windows_sys::Win32::Storage::FileSystem::{
    FILE_ALL_ACCESS, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ,
};
use windows_sys::Win32::System::Console::{
    GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE,
};
use windows_sys::Win32::System::IO::{
    CreateIoCompletionPort, GetQueuedCompletionStatus, OVERLAPPED,
};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_ACTIVE_PROCESS,
    JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    JOB_OBJECT_LIMIT_PROCESS_MEMORY, JOB_OBJECT_UILIMIT_DESKTOP,
    JOB_OBJECT_UILIMIT_DISPLAYSETTINGS, JOB_OBJECT_UILIMIT_EXITWINDOWS,
    JOB_OBJECT_UILIMIT_GLOBALATOMS, JOB_OBJECT_UILIMIT_HANDLES, JOB_OBJECT_UILIMIT_READCLIPBOARD,
    JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS, JOB_OBJECT_UILIMIT_WRITECLIPBOARD,
    JOBOBJECT_ASSOCIATE_COMPLETION_PORT, JOBOBJECT_BASIC_UI_RESTRICTIONS,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectAssociateCompletionPortInformation,
    JobObjectBasicUIRestrictions, JobObjectExtendedLimitInformation, SetInformationJobObject,
};
use windows_sys::Win32::System::StationsAndDesktops::{GetProcessWindowStation, GetThreadDesktop};
use windows_sys::Win32::System::SystemServices::{
    JOB_OBJECT_MSG_ABNORMAL_EXIT_PROCESS, JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO,
    JOB_OBJECT_MSG_EXIT_PROCESS, JOB_OBJECT_MSG_PROCESS_MEMORY_LIMIT,
};
use windows_sys::Win32::System::Threading::{
    CREATE_NO_WINDOW, CREATE_SUSPENDED, CreateProcessAsUserW, CreateProcessW,
    DeleteProcThreadAttributeList, EXTENDED_STARTUPINFO_PRESENT, GetCurrentProcess,
    GetCurrentThreadId, GetExitCodeProcess, INFINITE, InitializeProcThreadAttributeList,
    LPPROC_THREAD_ATTRIBUTE_LIST, OpenProcessToken, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
    PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, PROCESS_INFORMATION, ResumeThread,
    STARTF_USESTDHANDLES, STARTUPINFOEXW, TerminateProcess, UpdateProcThreadAttribute,
    WaitForSingleObject,
};

const ALREADY_EXISTS: i32 = 0x800700B7_u32 as i32;
const ACCESS_ALLOWED_ACE_TYPE: u8 = 0;
const SE_GROUP_INTEGRITY: u32 = 0x20;

fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

fn wide_path(path: &Path) -> Vec<u16> {
    path.as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// A container name fits in 64 characters.
fn container_name(id: &str) -> String {
    if id.len() <= 48 {
        return format!("Termix.Plugin.{id}");
    }
    let mut hash: u64 = 0xcbf29ce484222325;
    for b in id.bytes() {
        hash ^= b as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("Termix.Plugin.{hash:016x}")
}

struct Sid(PSID);

/// A SID from ConvertStringSidToSidW, freed with LocalFree.
struct LocalSid(PSID);

impl Drop for LocalSid {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { LocalFree(self.0) };
        }
    }
}

/// ALL APPLICATION PACKAGES.
fn any_package_sid() -> Result<LocalSid, String> {
    let text = wide("S-1-15-2-1");
    let mut sid: PSID = null_mut();
    if unsafe { ConvertStringSidToSidW(text.as_ptr(), &mut sid) } == 0 {
        return Err("app package SID".into());
    }
    Ok(LocalSid(sid))
}

impl Drop for Sid {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { FreeSid(self.0) };
        }
    }
}

fn container_sid(id: &str) -> Result<Sid, String> {
    let name = wide(&container_name(id));
    let display = wide(&format!("Termix plugin {id}"));
    let mut sid: PSID = null_mut();
    let hr = unsafe {
        CreateAppContainerProfile(
            name.as_ptr(),
            display.as_ptr(),
            display.as_ptr(),
            null(),
            0,
            &mut sid,
        )
    };
    if hr == 0 {
        return Ok(Sid(sid));
    }
    if hr != ALREADY_EXISTS {
        return Err(format!("AppContainer profile: 0x{hr:08x}"));
    }
    let hr = unsafe { DeriveAppContainerSidFromAppContainerName(name.as_ptr(), &mut sid) };
    if hr != 0 {
        return Err(format!("AppContainer SID: 0x{hr:08x}"));
    }
    Ok(Sid(sid))
}

/// Whether the folder already allows this SID the rights, so a tree is not
/// walked again on every start.
unsafe fn has_grant(acl: *const ACL, sid: PSID, mask: u32) -> bool {
    if acl.is_null() {
        return false;
    }
    let mut info: ACL_SIZE_INFORMATION = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        GetAclInformation(
            acl,
            &mut info as *mut _ as *mut c_void,
            size_of::<ACL_SIZE_INFORMATION>() as u32,
            AclSizeInformation,
        )
    };
    if ok == 0 {
        return false;
    }
    for index in 0..info.AceCount {
        let mut ace: *mut c_void = null_mut();
        if unsafe { GetAce(acl, index, &mut ace) } == 0 || ace.is_null() {
            continue;
        }
        let header = unsafe { &*(ace as *const ACE_HEADER) };
        if header.AceType != ACCESS_ALLOWED_ACE_TYPE {
            continue;
        }
        let allowed = ace as *const ACCESS_ALLOWED_ACE;
        let ace_sid = unsafe { &(*allowed).SidStart } as *const u32 as PSID;
        let ace_mask = unsafe { (*allowed).Mask };
        if unsafe { EqualSid(ace_sid, sid) } != 0 && ace_mask & mask == mask {
            return true;
        }
    }
    false
}

/// Adds an allow entry for a SID on a file or folder (and what is under
/// it), or takes that SID's entries away. Failing on a folder this user
/// can't change (an install under Program Files) is fine: those already
/// allow every app package to read.
fn grant(path: &Path, sid: PSID, mask: u32) -> Result<(), String> {
    set_entry(path, sid, mask, true)
}

fn revoke(path: &Path, sid: PSID) -> Result<(), String> {
    set_entry(path, sid, 0, false)
}

fn set_entry(path: &Path, sid: PSID, mask: u32, add: bool) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let name = wide_path(path);
    let mut dacl: *mut ACL = null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
    let rc = unsafe {
        GetNamedSecurityInfoW(
            name.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            &mut dacl,
            null_mut(),
            &mut descriptor,
        )
    };
    if rc != 0 {
        return Err(format!("read access list of {}: {rc}", path.display()));
    }
    let result = (|| {
        // Nothing to do: already granted, or nothing to take away.
        if unsafe { has_grant(dacl, sid, mask) } == add {
            return Ok(());
        }
        let inheritance = if path.is_dir() {
            CONTAINER_INHERIT_ACE | OBJECT_INHERIT_ACE
        } else {
            NO_INHERITANCE
        };
        let entry = EXPLICIT_ACCESS_W {
            grfAccessPermissions: mask,
            grfAccessMode: if add { GRANT_ACCESS } else { REVOKE_ACCESS },
            grfInheritance: inheritance,
            Trustee: TRUSTEE_W {
                pMultipleTrustee: null_mut(),
                MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_WELL_KNOWN_GROUP,
                ptstrName: sid as *mut u16,
            },
        };
        let mut updated: *mut ACL = null_mut();
        let rc = unsafe { SetEntriesInAclW(1, &entry, dacl, &mut updated) };
        if rc != 0 {
            return Err(format!("build access list: {rc}"));
        }
        let rc = unsafe {
            SetNamedSecurityInfoW(
                name.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                updated,
                null(),
            )
        };
        unsafe { LocalFree(updated as *mut c_void) };
        if rc != 0 && rc != 5 {
            return Err(format!("grant {}: {rc}", path.display()));
        }
        Ok(())
    })();
    unsafe { LocalFree(descriptor) };
    result
}

/// An AppContainer process can't start (DLL init fails) when it can't use
/// the window station and desktop it runs on. The interactive one (WinSta0)
/// already lets every app package in; a service session's does not, so add
/// the same entry there. A failure here is left to show at process start.
fn open_window_objects(any_package: PSID) {
    // WINSTA_ENUMDESKTOPS | WINSTA_READATTRIBUTES | WINSTA_ACCESSGLOBALATOMS
    // | WINSTA_ENUMERATE | READ_CONTROL
    let station_mask = 0x1 | 0x2 | 0x20 | 0x100 | 0x20000;
    // DESKTOP_READOBJECTS | DESKTOP_ENUMERATE | READ_CONTROL
    let desktop_mask = 0x1 | 0x40 | 0x20000;
    let station = unsafe { GetProcessWindowStation() };
    let desktop = unsafe { GetThreadDesktop(GetCurrentThreadId()) };
    for (handle, mask) in [
        (station as HANDLE, station_mask),
        (desktop as HANDLE, desktop_mask),
    ] {
        if handle.is_null() {
            continue;
        }
        let mut dacl: *mut ACL = null_mut();
        let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
        let rc = unsafe {
            GetSecurityInfo(
                handle,
                SE_WINDOW_OBJECT,
                DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                &mut dacl,
                null_mut(),
                &mut descriptor,
            )
        };
        if rc != 0 {
            continue;
        }
        if !unsafe { has_grant(dacl, any_package, mask) } {
            let entry = EXPLICIT_ACCESS_W {
                grfAccessPermissions: mask,
                grfAccessMode: GRANT_ACCESS,
                grfInheritance: NO_INHERITANCE,
                Trustee: TRUSTEE_W {
                    pMultipleTrustee: null_mut(),
                    MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
                    TrusteeForm: TRUSTEE_IS_SID,
                    TrusteeType: TRUSTEE_IS_WELL_KNOWN_GROUP,
                    ptstrName: any_package as *mut u16,
                },
            };
            let mut updated: *mut ACL = null_mut();
            if unsafe { SetEntriesInAclW(1, &entry, dacl, &mut updated) } == 0 {
                unsafe {
                    SetSecurityInfo(
                        handle,
                        SE_WINDOW_OBJECT,
                        DACL_SECURITY_INFORMATION,
                        null_mut(),
                        null_mut(),
                        updated,
                        null(),
                    );
                    LocalFree(updated as *mut c_void);
                }
            }
        }
        unsafe { LocalFree(descriptor) };
    }
}

/// Standard Windows quoting, so the runtime sees the same argv.
fn quote_arg(arg: &str, out: &mut String) {
    if !arg.is_empty() && !arg.contains([' ', '\t', '\n', '"']) {
        out.push_str(arg);
        return;
    }
    out.push('"');
    let mut slashes = 0;
    for ch in arg.chars() {
        match ch {
            '\\' => slashes += 1,
            '"' => {
                out.extend(std::iter::repeat_n('\\', slashes * 2 + 1));
                out.push('"');
                slashes = 0;
            }
            _ => {
                out.extend(std::iter::repeat_n('\\', slashes));
                out.push(ch);
                slashes = 0;
            }
        }
    }
    out.extend(std::iter::repeat_n('\\', slashes * 2));
    out.push('"');
}

pub fn command_line(program: &str, rest: &[String]) -> String {
    let mut line = String::new();
    quote_arg(program, &mut line);
    for arg in rest {
        line.push(' ');
        quote_arg(arg, &mut line);
    }
    line
}

struct Handle(HANDLE);

impl Drop for Handle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CloseHandle(self.0) };
        }
    }
}

fn make_job(policy: &Policy) -> Result<Handle, String> {
    let job = unsafe { CreateJobObjectW(null(), null()) };
    if job.is_null() {
        return Err("job object".into());
    }
    let job = Handle(job);
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        | JOB_OBJECT_LIMIT_PROCESS_MEMORY
        | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
    limits.ProcessMemoryLimit = policy.memory_bytes() as usize;
    if !policy.child_process {
        limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
        limits.BasicLimitInformation.ActiveProcessLimit = 1;
    }
    let ok = unsafe {
        SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const c_void,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if ok == 0 {
        return Err(format!("job limits: {}", unsafe { GetLastError() }));
    }
    let ui = JOBOBJECT_BASIC_UI_RESTRICTIONS {
        UIRestrictionsClass: JOB_OBJECT_UILIMIT_DESKTOP
            | JOB_OBJECT_UILIMIT_DISPLAYSETTINGS
            | JOB_OBJECT_UILIMIT_EXITWINDOWS
            | JOB_OBJECT_UILIMIT_GLOBALATOMS
            | JOB_OBJECT_UILIMIT_HANDLES
            | JOB_OBJECT_UILIMIT_READCLIPBOARD
            | JOB_OBJECT_UILIMIT_SYSTEMPARAMETERS
            | JOB_OBJECT_UILIMIT_WRITECLIPBOARD,
    };
    unsafe {
        SetInformationJobObject(
            job.0,
            JobObjectBasicUIRestrictions,
            &ui as *const _ as *const c_void,
            size_of::<JOBOBJECT_BASIC_UI_RESTRICTIONS>() as u32,
        )
    };
    Ok(job)
}

/// The job reports to this port, so a memory overrun is known for sure.
fn watch_job(job: &Handle) -> Result<Handle, String> {
    let port = unsafe { CreateIoCompletionPort(INVALID_HANDLE_VALUE, null_mut(), 0, 1) };
    if port.is_null() {
        return Err("completion port".into());
    }
    let port = Handle(port);
    let link = JOBOBJECT_ASSOCIATE_COMPLETION_PORT {
        CompletionKey: null_mut(),
        CompletionPort: port.0,
    };
    let ok = unsafe {
        SetInformationJobObject(
            job.0,
            JobObjectAssociateCompletionPortInformation,
            &link as *const _ as *const c_void,
            size_of::<JOBOBJECT_ASSOCIATE_COMPLETION_PORT>() as u32,
        )
    };
    if ok == 0 {
        return Err("job messages".into());
    }
    Ok(port)
}

/// Waits for the runtime to end. True when it went over its memory cap.
fn wait(port: &Handle, process: &Handle, pid: u32) -> bool {
    let mut over_cap = false;
    loop {
        let mut message: u32 = 0;
        let mut key: usize = 0;
        let mut detail: *mut OVERLAPPED = null_mut();
        let ok = unsafe {
            GetQueuedCompletionStatus(port.0, &mut message, &mut key, &mut detail, INFINITE)
        };
        if ok == 0 {
            unsafe { WaitForSingleObject(process.0, INFINITE) };
            return over_cap;
        }
        let from = detail as usize as u32;
        match message {
            JOB_OBJECT_MSG_PROCESS_MEMORY_LIMIT => {
                over_cap = true;
                unsafe { TerminateProcess(process.0, EXIT_MEMORY as u32) };
            }
            JOB_OBJECT_MSG_EXIT_PROCESS | JOB_OBJECT_MSG_ABNORMAL_EXIT_PROCESS if from == pid => {
                return over_cap;
            }
            JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO => return over_cap,
            _ => {}
        }
    }
}

pub fn run(policy: &Policy, program: &str, rest: &[String]) -> i32 {
    match start(policy, program, rest) {
        Ok(code) => code,
        Err(e) => {
            eprintln!("termix-plugin-jail: {e}");
            EXIT_FENCE
        }
    }
}

/// How the process is fenced. An AppContainer is the full fence, but it
/// blocks loopback connections in and out and the named pipes libuv makes
/// for child processes, so plugins with sockets or child processes run at
/// low integrity instead, and serial devices need the normal level.
#[derive(Debug, PartialEq)]
pub enum Mode {
    AppContainer,
    LowIntegrity,
    JobOnly,
}

pub fn mode(policy: &Policy) -> Mode {
    if policy.addons {
        Mode::JobOnly
    } else if policy.net || policy.child_process {
        Mode::LowIntegrity
    } else {
        Mode::AppContainer
    }
}

/// A primary token with no privileges at low integrity.
fn low_token() -> Result<Handle, String> {
    let mut own: HANDLE = null_mut();
    let access = TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT;
    if unsafe { OpenProcessToken(GetCurrentProcess(), access, &mut own) } == 0 {
        return Err("open token".into());
    }
    let own = Handle(own);
    let mut restricted: HANDLE = null_mut();
    let ok = unsafe {
        CreateRestrictedToken(
            own.0,
            DISABLE_MAX_PRIVILEGE,
            0,
            null(),
            0,
            null(),
            0,
            null(),
            &mut restricted,
        )
    };
    if ok == 0 {
        return Err("restricted token".into());
    }
    let restricted = Handle(restricted);
    let low = wide("S-1-16-4096");
    let mut sid: PSID = null_mut();
    if unsafe { ConvertStringSidToSidW(low.as_ptr(), &mut sid) } == 0 {
        return Err("low integrity SID".into());
    }
    let label = TOKEN_MANDATORY_LABEL {
        Label: SID_AND_ATTRIBUTES {
            Sid: sid,
            Attributes: SE_GROUP_INTEGRITY,
        },
    };
    let ok = unsafe {
        SetTokenInformation(
            restricted.0,
            TokenIntegrityLevel,
            &label as *const _ as *const c_void,
            (size_of::<TOKEN_MANDATORY_LABEL>() + GetLengthSid(sid) as usize) as u32,
        )
    };
    unsafe { LocalFree(sid) };
    if ok == 0 {
        return Err("set integrity level".into());
    }
    Ok(restricted)
}

/// Lets a low integrity process write its data folder and nothing else.
fn label_low(path: &Path) -> Result<(), String> {
    let text = wide("S:(ML;OICI;NW;;;LW)");
    let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
    let ok = unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            text.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            null_mut(),
        )
    };
    if ok == 0 {
        return Err("label descriptor".into());
    }
    let mut present = 0;
    let mut defaulted = 0;
    let mut sacl: *mut ACL = null_mut();
    unsafe { GetSecurityDescriptorSacl(descriptor, &mut present, &mut sacl, &mut defaulted) };
    let name = wide_path(path);
    let rc = unsafe {
        SetNamedSecurityInfoW(
            name.as_ptr(),
            SE_FILE_OBJECT,
            LABEL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            null(),
            sacl,
        )
    };
    unsafe { LocalFree(descriptor) };
    if rc != 0 {
        return Err(format!("label {}: {rc}", path.display()));
    }
    Ok(())
}

fn start(policy: &Policy, program: &str, rest: &[String]) -> Result<i32, String> {
    for dir in &policy.write {
        std::fs::create_dir_all(dir).map_err(|e| format!("data folder: {e}"))?;
    }
    let mut container: Option<Sid> = None;
    let mut token: Option<Handle> = None;
    match mode(policy) {
        Mode::AppContainer => {
            let sid = container_sid(&policy.name)?;
            // Reads go to every app package: an entry for one container
            // stops low integrity plugins from reading the same folders.
            // These folders hold only app and plugin code.
            let any = any_package_sid()?;
            open_window_objects(any.0);
            let read_mask = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
            if let Some(dir) = Path::new(program).parent() {
                grant(dir, any.0, read_mask)?;
            }
            for path in &policy.read {
                grant(path, any.0, read_mask)?;
            }
            for path in &policy.write {
                grant(path, sid.0, FILE_ALL_ACCESS)?;
            }
            container = Some(sid);
        }
        Mode::LowIntegrity => {
            // A plugin that ran in its container before keeps an entry on
            // its folder, which would lock it out at low integrity.
            let sid = container_sid(&policy.name)?;
            for path in &policy.write {
                revoke(path, sid.0)?;
                label_low(path)?;
            }
            token = Some(low_token()?);
        }
        Mode::JobOnly => {}
    }
    let mut security = SECURITY_CAPABILITIES {
        AppContainerSid: container.as_ref().map_or(null_mut(), |s| s.0),
        Capabilities: null_mut(),
        CapabilityCount: 0,
        Reserved: 0,
    };

    // Only stdin, stdout and stderr pass to the child.
    let mut handles: Vec<HANDLE> = Vec::new();
    for which in [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
        let handle = unsafe { GetStdHandle(which) };
        if handle.is_null() || handle as isize == -1 {
            return Err("missing standard handle".into());
        }
        unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) };
        if !handles.contains(&handle) {
            handles.push(handle);
        }
    }

    let mut size: usize = 0;
    unsafe { InitializeProcThreadAttributeList(null_mut(), 2, 0, &mut size) };
    let mut buffer = vec![0u8; size];
    let list = buffer.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST;
    if unsafe { InitializeProcThreadAttributeList(list, 2, 0, &mut size) } == 0 {
        return Err("attribute list".into());
    }
    let attributes = (|| {
        if container.is_some() {
            let ok = unsafe {
                UpdateProcThreadAttribute(
                    list,
                    0,
                    PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
                    &mut security as *mut _ as *const c_void,
                    size_of::<SECURITY_CAPABILITIES>(),
                    null_mut(),
                    null(),
                )
            };
            if ok == 0 {
                return Err("security capabilities attribute".to_string());
            }
        }
        let ok = unsafe {
            UpdateProcThreadAttribute(
                list,
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
                handles.as_ptr() as *const c_void,
                handles.len() * size_of::<HANDLE>(),
                null_mut(),
                null(),
            )
        };
        if ok == 0 {
            return Err("handle list attribute".to_string());
        }
        Ok(())
    })();
    if let Err(e) = attributes {
        unsafe { DeleteProcThreadAttributeList(list) };
        return Err(e);
    }

    let mut startup: STARTUPINFOEXW = unsafe { std::mem::zeroed() };
    startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = unsafe { GetStdHandle(STD_INPUT_HANDLE) };
    startup.StartupInfo.hStdOutput = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
    startup.StartupInfo.hStdError = unsafe { GetStdHandle(STD_ERROR_HANDLE) };
    startup.lpAttributeList = list;

    let job = make_job(policy)?;
    let port = watch_job(&job)?;
    let application = wide(program);
    let mut line = wide(&command_line(program, rest));
    let mut info: PROCESS_INFORMATION = unsafe { std::mem::zeroed() };
    let flags = EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_NO_WINDOW;
    let ok = unsafe {
        match &token {
            Some(token) => CreateProcessAsUserW(
                token.0,
                application.as_ptr(),
                line.as_mut_ptr(),
                null(),
                null(),
                1,
                flags,
                null(),
                null(),
                &startup.StartupInfo,
                &mut info,
            ),
            None => CreateProcessW(
                application.as_ptr(),
                line.as_mut_ptr(),
                null(),
                null(),
                1,
                flags,
                null(),
                null(),
                &startup.StartupInfo,
                &mut info,
            ),
        }
    };
    let error = unsafe { GetLastError() };
    unsafe { DeleteProcThreadAttributeList(list) };
    if ok == 0 {
        return Err(format!("could not start the runtime: {error}"));
    }
    let process = Handle(info.hProcess);
    let thread = Handle(info.hThread);
    if unsafe { AssignProcessToJobObject(job.0, process.0) } == 0 {
        unsafe { TerminateProcess(process.0, EXIT_FENCE as u32) };
        return Err("could not put the runtime in its job".into());
    }
    unsafe { ResumeThread(thread.0) };
    drop(thread);

    let over_cap = wait(&port, &process, info.dwProcessId);
    unsafe { WaitForSingleObject(process.0, INFINITE) };
    let mut code: u32 = 1;
    unsafe { GetExitCodeProcess(process.0, &mut code) };
    if over_cap {
        eprintln!(
            "termix-plugin-jail: memory limit of {} MB reached, stopping",
            policy.memory_mb
        );
        return Ok(EXIT_MEMORY);
    }
    Ok(code as i32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_like_the_c_runtime() {
        let line = command_line(
            "C:\\a b\\node.exe",
            &["--x=C:\\p q\\".into(), "a\"b".into()],
        );
        assert_eq!(line, r#""C:\a b\node.exe" "--x=C:\p q\\" "a\"b""#);
    }

    #[test]
    fn container_names_fit() {
        assert_eq!(container_name("ssh-terminal"), "Termix.Plugin.ssh-terminal");
        let long = "a".repeat(64);
        assert!(container_name(&long).len() <= 64);
    }
}
